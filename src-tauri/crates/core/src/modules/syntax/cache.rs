//! The colors of the last few texts colored, so the viewer can ask for them a block of lines at a
//! time. Coloring runs on a thread of its own, the only one to hold the states a changed text is
//! colored again from: syntect's parser states hold oniguruma regions, which cannot leave the
//! thread that made them. Lines already colored are read without it.

use std::collections::VecDeque;
use std::panic::{self, AssertUnwindSafe};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};

use super::contracts::LineColors;
use crate::shared::sync::lock;

/// Texts kept: both sides of the diff on screen, and those of the file before it.
const KEPT: usize = 4;

pub type Lines = Arc<Vec<LineColors>>;

/// What a coloring leaves: its lines, shared with the callers, and, kept on the coloring thread,
/// what the next coloring of the same file starts from.
pub trait Coloring {
    fn lines(&self) -> &Lines;
}

/// Colors the text of a file's bytes, from what the coloring of the text before it left, if kept;
/// `None` when the flag is set before the end.
pub type Colorer<C> = fn(&str, Vec<u8>, Option<&C>, &AtomicBool) -> Option<C>;

/// One text to color: a version of a file (`key`) and the hash of its bytes.
struct Job {
    key: String,
    hash: u64,
    path: String,
    bytes: Vec<u8>,
    reply: mpsc::Sender<Option<Lines>>,
}

/// The run on the coloring thread, and its stop flag.
struct Running {
    key: String,
    hash: u64,
    cancel: Arc<AtomicBool>,
}

#[derive(Default)]
struct Shared {
    /// The lines of the texts kept, least recently colored first, one per key.
    kept: Mutex<Vec<(String, u64, Lines)>>,
    running: Mutex<Option<Running>>,
}

impl Shared {
    /// The lines kept under `key`, of the text with `hash`, or of any when `None`.
    fn kept(&self, key: &str, hash: Option<u64>) -> Option<Lines> {
        lock(&self.kept)
            .iter()
            .find(|(k, h, _)| k == key && hash.is_none_or(|hash| *h == hash))
            .map(|(_, _, lines)| lines.clone())
    }

    fn keep(&self, key: &str, hash: u64, lines: Lines) {
        let mut kept = lock(&self.kept);
        kept.retain(|(k, _, _)| k != key);
        kept.push((key.to_string(), hash, lines));
        if kept.len() > KEPT {
            kept.remove(0);
        }
    }
}

/// The coloring thread and the lines it colored (`ColorCache`).
pub struct ColorThread<C> {
    shared: Arc<Shared>,
    jobs: Mutex<Option<mpsc::Sender<Job>>>,
    color: Colorer<C>,
}

impl<C: Coloring + 'static> ColorThread<C> {
    pub fn new(color: Colorer<C>) -> Self {
        Self {
            shared: Arc::default(),
            jobs: Mutex::default(),
            color,
        }
    }

    /// The colors of the text with `hash` under `key`: kept, or colored on the coloring thread,
    /// after what is asked before. A newer text under the same key stops the run of an older one,
    /// and makes the callers of the older one get `None`, to read the file again.
    pub fn colored(
        &self,
        key: &str,
        hash: u64,
        path: &str,
        bytes: Vec<u8>,
    ) -> Option<Lines> {
        if let Some(lines) = self.shared.kept(key, Some(hash)) {
            return Some(lines);
        }
        let (reply, answer) = mpsc::channel();
        self.send(Job {
            key: key.to_string(),
            hash,
            path: path.to_string(),
            bytes,
            reply,
        });
        // after the job is queued: a run of an older text that started before it stops now, one
        // that starts after sees it in the queue
        if let Some(running) = lock(&self.shared.running).as_ref() {
            if running.key == key && running.hash != hash {
                running.cancel.store(true, Ordering::Relaxed);
            }
        }
        answer.recv().ok().flatten()
    }

    /// The last lines kept under `key`, whatever text they were of.
    pub fn latest(&self, key: &str) -> Option<Lines> {
        self.shared.kept(key, None)
    }

    /// Queues a job, starting the thread the first time, and again should it be gone.
    fn send(&self, job: Job) {
        let mut jobs = lock(&self.jobs);
        let job = match jobs.as_ref() {
            Some(sender) => match sender.send(job) {
                Ok(()) => return,
                Err(mpsc::SendError(job)) => job,
            },
            None => job,
        };
        let (sender, receiver) = mpsc::channel();
        let (shared, color) = (self.shared.clone(), self.color);
        *lock(&shared.running) = None;
        let started = std::thread::Builder::new()
            .name("syntax-colors".into())
            .spawn(move || run(&receiver, &shared, color));
        if let Err(error) = started {
            tracing::error!(%error, "the coloring thread did not start");
            return;
        }
        // a new channel's receiver is alive
        let _ = sender.send(job);
        *jobs = Some(sender);
    }
}

/// The coloring thread: one job after the other, each answered from the kept lines when its text
/// was colored meanwhile, or with `None` when a newer text of its file waits behind it.
fn run<C: Coloring>(jobs: &mpsc::Receiver<Job>, shared: &Shared, color: Colorer<C>) {
    // what the last texts colored left, one per key, least recently colored first
    let mut states: Vec<(String, C)> = Vec::new();
    let mut pending: VecDeque<Job> = VecDeque::new();
    loop {
        if pending.is_empty() {
            match jobs.recv() {
                Ok(job) => pending.push_back(job),
                Err(_) => return,
            }
        }
        let cancel = Arc::new(AtomicBool::new(false));
        let job = {
            // under the lock a caller checks it with: its job is either seen here or sees the run
            let mut running = lock(&shared.running);
            pending.extend(jobs.try_iter());
            let Some(job) = pending.pop_front() else {
                continue;
            };
            if let Some(lines) = shared.kept(&job.key, Some(job.hash)) {
                let _ = job.reply.send(Some(lines));
                continue;
            }
            let newer = pending
                .iter()
                .any(|later| later.key == job.key && later.hash != job.hash);
            if newer {
                let _ = job.reply.send(None);
                continue;
            }
            *running = Some(Running {
                key: job.key.clone(),
                hash: job.hash,
                cancel: cancel.clone(),
            });
            job
        };
        let before = states.iter().find(|(key, _)| *key == job.key);
        let before = before.map(|(_, state)| state);
        // a grammar that panics loses this text's colors, not the thread
        let colored = panic::catch_unwind(AssertUnwindSafe(|| {
            color(&job.path, job.bytes, before, &cancel)
        }))
        .unwrap_or_else(|_| {
            tracing::error!(path = job.path, "coloring panicked");
            None
        });
        *lock(&shared.running) = None;
        let Some(state) = colored else {
            let _ = job.reply.send(None);
            continue;
        };
        let lines = state.lines().clone();
        states.retain(|(key, _)| *key != job.key);
        states.push((job.key.clone(), state));
        if states.len() > KEPT {
            states.remove(0);
        }
        shared.keep(&job.key, job.hash, lines.clone());
        let _ = job.reply.send(Some(lines));
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::*;

    /// A text is a number, added to the one before it: its single line's `check` shows both.
    struct Added {
        value: u32,
        lines: Lines,
    }

    impl Coloring for Added {
        fn lines(&self) -> &Lines {
            &self.lines
        }
    }

    /// The text `wait` runs until stopped, `panic` panics.
    fn add(_: &str, bytes: Vec<u8>, before: Option<&Added>, cancel: &AtomicBool) -> Option<Added> {
        match bytes.as_slice() {
            b"wait" => {
                while !cancel.load(Ordering::Relaxed) {
                    std::thread::yield_now();
                }
                return None;
            }
            b"panic" => panic!("grammar exploded"),
            _ => {}
        }
        let number: u32 = String::from_utf8(bytes).unwrap().parse().unwrap();
        let value = before.map_or(0, |before| before.value) + number;
        let lines = vec![LineColors {
            check: value,
            spans: Vec::new(),
        }];
        Some(Added {
            value,
            lines: Arc::new(lines),
        })
    }

    fn check(lines: Option<Lines>) -> Option<u32> {
        lines.map(|lines| lines[0].check)
    }

    fn ask(colors: &Arc<ColorThread<Added>>, key: &str, hash: u64, text: &str) -> Option<u32> {
        check(colors.colored(key, hash, "a.rs", text.into()))
    }

    fn ask_later(
        colors: &Arc<ColorThread<Added>>,
        key: &'static str,
        hash: u64,
        text: &'static str,
    ) -> std::thread::JoinHandle<Option<u32>> {
        let colors = colors.clone();
        let handle = std::thread::spawn(move || ask(&colors, key, hash, text));
        std::thread::sleep(Duration::from_millis(50));
        handle
    }

    #[test]
    fn a_text_is_colored_once_and_a_changed_one_from_it() {
        let colors = Arc::new(ColorThread::new(add));
        assert_eq!(ask(&colors, "a", 1, "1"), Some(1));
        assert_eq!(
            ask(&colors, "a", 1, "100"),
            Some(1),
            "kept: not colored again"
        );
        assert_eq!(ask(&colors, "a", 2, "5"), Some(6), "from the text before");
        assert_eq!(ask(&colors, "b", 1, "5"), Some(5), "another file");
        assert_eq!(check(colors.latest("a")), Some(6));
        assert_eq!(check(colors.latest("c")), None);
    }

    #[test]
    fn a_newer_text_stops_the_run_of_the_old_one() {
        let colors = Arc::new(ColorThread::new(add));
        let old = ask_later(&colors, "a", 1, "wait");
        assert_eq!(ask(&colors, "a", 2, "3"), Some(3));
        assert_eq!(
            old.join().unwrap(),
            None,
            "the old text's caller reads again"
        );
    }

    #[test]
    fn a_text_queued_behind_a_newer_one_of_its_file_is_not_colored() {
        let colors = Arc::new(ColorThread::new(add));
        // the thread is busy with another file while both texts of "a" queue
        let busy = ask_later(&colors, "b", 1, "wait");
        let old = ask_later(&colors, "a", 1, "1");
        let new = ask_later(&colors, "a", 2, "2");
        assert_eq!(ask(&colors, "b", 2, "7"), Some(7), "stops the busy run");
        assert_eq!(busy.join().unwrap(), None);
        assert_eq!(old.join().unwrap(), None);
        assert_eq!(new.join().unwrap(), Some(2));
    }

    #[test]
    fn only_the_last_texts_are_kept() {
        let colors = Arc::new(ColorThread::new(add));
        for key in ["a", "b", "c", "d", "e"] {
            ask(&colors, key, 1, "1");
        }
        // "a" went, and what it left: colored anew
        assert_eq!(ask(&colors, "a", 1, "5"), Some(5));
        assert_eq!(ask(&colors, "e", 1, "5"), Some(1));
    }

    #[test]
    fn a_panic_while_coloring_answers_none_and_the_thread_goes_on() {
        let colors = Arc::new(ColorThread::new(add));
        assert_eq!(ask(&colors, "a", 1, "panic"), None);
        assert_eq!(ask(&colors, "a", 2, "4"), Some(4));
    }
}
