//! Runs an expensive computation at most once at a time and shares the result.

use std::sync::{Condvar, Mutex, MutexGuard};

/// A caller arriving while a run is in flight waits for it, then shares the next run, which starts
/// after the caller arrived and so sees everything that changed before. However many callers pile
/// up during a run, exactly one more run follows it.
pub(crate) struct Coalesced<T> {
    state: Mutex<State<T>>,
    finished: Condvar,
}

struct State<T> {
    running: bool,
    /// Runs started so far; the one in flight, if any, is number `started`.
    started: u64,
    last: Option<(u64, T)>,
}

impl<T> Default for Coalesced<T> {
    fn default() -> Self {
        Self {
            state: Mutex::new(State {
                running: false,
                started: 0,
                last: None,
            }),
            finished: Condvar::new(),
        }
    }
}

/// Marks the run finished even if `work` panics, so waiting callers start a new one.
struct RunGuard<'a, T> {
    owner: &'a Coalesced<T>,
}

impl<T> Drop for RunGuard<'_, T> {
    fn drop(&mut self) {
        self.owner.lock().running = false;
        self.owner.finished.notify_all();
    }
}

impl<T> Coalesced<T> {
    fn lock(&self) -> MutexGuard<'_, State<T>> {
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }
}

impl<T: Clone> Coalesced<T> {
    pub(crate) fn run(&self, work: impl FnOnce() -> T) -> T {
        let mut state = self.lock();
        let needed = state.started + 1;
        loop {
            if let Some((run, value)) = &state.last {
                if *run >= needed {
                    return value.clone();
                }
            }
            if !state.running {
                state.running = true;
                state.started += 1;
                let run = state.started;
                drop(state);

                let guard = RunGuard { owner: self };
                let value = work();
                self.lock().last = Some((run, value.clone()));
                drop(guard);
                return value;
            }
            state = self.finished.wait(state).unwrap_or_else(|e| e.into_inner());
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{mpsc, Arc};
    use std::time::Duration;

    use super::*;

    #[test]
    fn callers_during_a_run_share_exactly_one_more_run() {
        let coalesced = Arc::new(Coalesced::default());
        let runs = Arc::new(AtomicUsize::new(0));
        let (release, wait_release) = mpsc::channel::<()>();
        let (started, wait_started) = mpsc::channel::<()>();

        let first = {
            let (coalesced, runs) = (coalesced.clone(), runs.clone());
            std::thread::spawn(move || {
                coalesced.run(|| {
                    started.send(()).unwrap();
                    wait_release.recv().unwrap();
                    runs.fetch_add(1, Ordering::SeqCst)
                })
            })
        };
        wait_started.recv().unwrap();

        let late: Vec<_> = (0..5)
            .map(|_| {
                let (coalesced, runs) = (coalesced.clone(), runs.clone());
                std::thread::spawn(move || coalesced.run(|| runs.fetch_add(1, Ordering::SeqCst)))
            })
            .collect();
        // Let the late callers reach the wait before the first run ends.
        std::thread::sleep(Duration::from_millis(100));
        release.send(()).unwrap();

        assert_eq!(first.join().unwrap(), 0);
        for caller in late {
            assert_eq!(
                caller.join().unwrap(),
                1,
                "late callers share the second run"
            );
        }
        assert_eq!(runs.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn a_caller_after_a_finished_run_starts_a_new_one() {
        let coalesced = Coalesced::default();
        assert_eq!(coalesced.run(|| 1), 1);
        assert_eq!(coalesced.run(|| 2), 2);
    }

    #[test]
    fn a_panicking_run_does_not_block_the_next_caller() {
        let coalesced = Coalesced::default();
        let panicked = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            coalesced.run(|| -> u32 { panic!("git exploded") })
        }));
        assert!(panicked.is_err());
        assert_eq!(coalesced.run(|| 7), 7);
    }
}
