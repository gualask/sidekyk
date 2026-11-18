//! One helper process: started from its command, written to through its stdin by a thread of its
//! own, its output read by `output` into the replies its requests wait for.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStderr, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use anyhow::Context;
use serde_json::value::RawValue;

use super::super::protocol::{write_frame, Request, RequestFrame, WireError};
use super::output::{log_line, read_messages};
use super::Kept;
use crate::infrastructure::hide_console;
use crate::modules::search::ContentFile;
use crate::shared::sync::lock;

/// One helper process.
pub(super) struct Connection {
    /// The frames to write, in order, by `write_frames`: no caller waits on the pipe (the window's
    /// visibility is told on the main thread), however full a stuck helper left it. `None` once
    /// closed: what is left is written, then the helper reads the end of its input and exits.
    outgoing: Mutex<Option<Sender<Vec<u8>>>>,
    pub(super) replies: Arc<Replies>,
    /// Waited for by `output` once its output ends; killed before when it stops answering.
    child: Arc<Mutex<Child>>,
}

/// The requests waiting for their reply, until the helper stops.
#[derive(Default)]
pub(super) struct Replies {
    pub(super) waiting: Mutex<HashMap<u64, Sender<Incoming>>>,
    /// Set with `waiting` locked, so no request waits on a helper that stopped.
    pub(super) stopped: AtomicBool,
    /// The app closed it, idle: nothing to read again, nothing to wait for before the next.
    pub(super) closed: AtomicBool,
}

/// What a request sent waits for; dropped, nobody waits for it any longer.
pub(super) struct Waiting {
    id: u64,
    replies: Arc<Replies>,
    receiver: Receiver<Incoming>,
}

impl Waiting {
    /// The next of what the request waits for, if it comes within `timeout`; disconnected once
    /// the helper stopped.
    pub(super) fn next(&self, timeout: Duration) -> Result<Incoming, RecvTimeoutError> {
        self.receiver.recv_timeout(timeout)
    }
}

impl Drop for Waiting {
    fn drop(&mut self) {
        lock(&self.replies.waiting).remove(&self.id);
    }
}

pub(super) enum Incoming {
    Contents(Vec<ContentFile>),
    Reply(Result<Box<RawValue>, WireError>),
    Bytes(Vec<u8>),
}

impl Connection {
    /// Starts the helper `command` runs, its messages read on a thread of their own, its stderr
    /// logged on another.
    pub(super) fn spawn(mut command: Command, kept: &Arc<Kept>) -> anyhow::Result<Arc<Self>> {
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        hide_console(&mut command);
        let mut child = command.spawn().context("could not start the helper")?;
        let stdin = child.stdin.take().context("no stdin")?;
        let stdout = child.stdout.take().context("no stdout")?;
        if let Some(stderr) = child.stderr.take() {
            std::thread::spawn(move || log_lines(stderr));
        }
        tracing::info!(pid = child.id(), "helper started");
        let replies = Arc::new(Replies::default());
        let (outgoing, frames) = mpsc::channel();
        std::thread::spawn(move || write_frames(stdin, &frames));
        let child = Arc::new(Mutex::new(child));
        let (read_replies, kept, read_child) = (replies.clone(), kept.clone(), child.clone());
        std::thread::spawn(move || read_messages(stdout, &read_replies, &kept, &read_child));
        Ok(Arc::new(Self {
            outgoing: Mutex::new(Some(outgoing)),
            replies,
            child,
        }))
    }

    /// Sends request `id`, its reply and what comes before it to the `Waiting` given back; none
    /// once the helper stopped, so no request waits on it.
    pub(super) fn send(&self, id: u64, request: Request) -> anyhow::Result<Waiting> {
        let (sender, receiver) = mpsc::channel();
        let waiting = {
            let mut waiting = lock(&self.replies.waiting);
            anyhow::ensure!(
                !self.replies.stopped.load(Ordering::Relaxed),
                "the helper stopped"
            );
            waiting.insert(id, sender);
            Waiting {
                id,
                replies: self.replies.clone(),
                receiver,
            }
        };
        self.write(id, request)?;
        Ok(waiting)
    }

    /// Queues request `id` for the helper, without waiting for it to be written.
    pub(super) fn write(&self, id: u64, request: Request) -> anyhow::Result<()> {
        let frame = frame(id, request)?;
        queue(lock(&self.outgoing).as_ref(), frame)
    }

    pub(super) fn close(&self) {
        self.replies.closed.store(true, Ordering::Relaxed);
        lock(&self.outgoing).take();
    }

    /// Kills a helper that stopped answering: its output ends, and the requests waiting fail
    /// (`output`). Held by `output` only once the output ended: it is ending already then.
    pub(super) fn kill(&self) {
        if let Ok(mut child) = self.child.try_lock() {
            let _ = child.kill();
        }
    }

    /// Tells a helper just started what the app keeps, as it is now: read under the lock its
    /// requests are queued with, so a change told meanwhile is never told before an older state.
    pub(super) fn tell_kept(&self, kept: &Kept, next_id: &AtomicU64) -> anyhow::Result<()> {
        let outgoing = lock(&self.outgoing);
        let tell = |request| {
            let id = next_id.fetch_add(1, Ordering::Relaxed);
            queue(outgoing.as_ref(), frame(id, request)?)
        };
        if kept.hidden.load(Ordering::Relaxed) {
            tell(Request::SetVisible { visible: false })?;
        }
        if let Some((repository, _)) = lock(&kept.watched).as_ref() {
            tell(Request::Watch {
                repository: Some(repository.clone()),
            })?;
        }
        Ok(())
    }
}

/// Request `id` as the helper reads it.
fn frame(id: u64, request: Request) -> anyhow::Result<Vec<u8>> {
    let mut frame = Vec::new();
    write_frame(&mut frame, &RequestFrame { id, request })?;
    Ok(frame)
}

fn queue(outgoing: Option<&Sender<Vec<u8>>>, frame: Vec<u8>) -> anyhow::Result<()> {
    let outgoing = outgoing.context("the helper was closed")?;
    outgoing
        .send(frame)
        .ok()
        .context("could not write to the helper")
}

/// Writes each frame queued to the helper's stdin, in order, until the queue closes (then its
/// stdin closes, which ends it) or a write fails: the helper ended, or was killed while its pipe
/// was full, which ends the write.
fn write_frames(mut stdin: ChildStdin, frames: &Receiver<Vec<u8>>) {
    for frame in frames {
        if let Err(error) = stdin.write_all(&frame).and_then(|()| stdin.flush()) {
            tracing::debug!(%error, "the helper is no longer written to");
            return;
        }
    }
}

/// Each line the helper writes to its stderr, to the app's log, until it ends.
fn log_lines(stderr: ChildStderr) {
    for line in BufReader::new(stderr).lines().map_while(Result::ok) {
        log_line(&line);
    }
}
