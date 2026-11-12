//! The watcher's reports, on a thread per watch: each batch of changes told at most once per
//! `REPORT_INTERVAL` while changes go on, the first at once, the last always.

use std::sync::mpsc::{Receiver, RecvTimeoutError};
use std::time::{Duration, Instant};

use super::watcher::REPORT_INTERVAL;
use crate::modules::folder::Changed;

/// Tells each batch received, throttled, until the debouncer stops.
pub(super) fn report_throttled(
    received: &Receiver<Changed>,
    mut on_change: Box<dyn FnMut(Changed) + Send>,
) {
    let mut throttle = Throttle::new(REPORT_INTERVAL);
    loop {
        let next = match throttle.due_at() {
            Some(due) => received.recv_timeout(due.saturating_duration_since(Instant::now())),
            None => received.recv().map_err(|_| RecvTimeoutError::Disconnected),
        };
        let told = match next {
            Ok(changed) => throttle.offer(changed, Instant::now()),
            Err(RecvTimeoutError::Timeout) => throttle.release(Instant::now()),
            // the watch is gone: what is held concerns nobody
            Err(RecvTimeoutError::Disconnected) => return,
        };
        if let Some(changed) = told {
            on_change(changed);
        }
    }
}

/// Batches told at most once per interval: the first after a quiet interval at once, those that
/// come before the interval ends held and told together when it does. No timer while idle.
struct Throttle {
    interval: Duration,
    last_told: Option<Instant>,
    /// Always within the interval of `last_told`.
    held: Option<Changed>,
}

impl Throttle {
    fn new(interval: Duration) -> Self {
        Self {
            interval,
            last_told: None,
            held: None,
        }
    }

    /// A batch received at `now`: what to tell at once, if anything.
    fn offer(&mut self, changed: Changed, now: Instant) -> Option<Changed> {
        let quiet = self
            .last_told
            .is_none_or(|told| now.saturating_duration_since(told) >= self.interval);
        if self.held.is_none() && quiet {
            self.last_told = Some(now);
            return Some(changed);
        }
        self.held = Some(match self.held.take() {
            Some(held) => joined(held, changed),
            None => changed,
        });
        None
    }

    /// When the batches held are due.
    fn due_at(&self) -> Option<Instant> {
        let told = self.last_told?;
        self.held.as_ref().map(|_| told + self.interval)
    }

    /// The batches held, told at `now`.
    fn release(&mut self, now: Instant) -> Option<Changed> {
        let held = self.held.take()?;
        self.last_told = Some(now);
        Some(held)
    }
}

/// Two batches as one: every path once, any if either lost events.
fn joined(first: Changed, second: Changed) -> Changed {
    match (first, second) {
        (Changed::Paths(mut paths), Changed::Paths(more)) => {
            paths.extend(more);
            paths.sort_unstable();
            paths.dedup();
            Changed::Paths(paths)
        }
        _ => Changed::Unknown,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn paths(names: &[&str]) -> Changed {
        Changed::Paths(names.iter().map(PathBuf::from).collect())
    }

    #[test]
    fn batches_go_on_at_most_once_per_interval_the_first_at_once_the_last_always() {
        let second = Duration::from_secs(1);
        let start = Instant::now();
        let at = |ms: u64| start + Duration::from_millis(ms);
        let mut throttle = Throttle::new(second);
        assert_eq!(throttle.due_at(), None);

        // the first at once, no timer
        assert_eq!(
            throttle.offer(paths(&["/r/a"]), at(0)),
            Some(paths(&["/r/a"]))
        );
        assert_eq!(throttle.due_at(), None);

        // those within the interval held together, each path once, due when it ends
        assert_eq!(throttle.offer(paths(&["/r/b", "/r/a"]), at(250)), None);
        assert_eq!(throttle.offer(paths(&["/r/b", "/r/c"]), at(500)), None);
        assert_eq!(throttle.due_at(), Some(at(1_000)));
        assert_eq!(
            throttle.release(at(1_000)),
            Some(paths(&["/r/a", "/r/b", "/r/c"]))
        );
        assert_eq!(throttle.due_at(), None);

        // still going on: the next interval counts from that report
        assert_eq!(throttle.offer(paths(&["/r/d"]), at(1_250)), None);
        assert_eq!(throttle.due_at(), Some(at(2_000)));
        assert_eq!(throttle.release(at(2_000)), Some(paths(&["/r/d"])));
        assert_eq!(throttle.release(at(2_100)), None);

        // a quiet interval: at once again
        assert_eq!(
            throttle.offer(paths(&["/r/e"]), at(3_000)),
            Some(paths(&["/r/e"]))
        );

        // events lost among those held: any path may have changed
        assert_eq!(throttle.offer(paths(&["/r/f"]), at(3_100)), None);
        assert_eq!(throttle.offer(Changed::Unknown, at(3_200)), None);
        assert_eq!(throttle.offer(paths(&["/r/g"]), at(3_300)), None);
        assert_eq!(throttle.release(at(4_000)), Some(Changed::Unknown));
    }
}
