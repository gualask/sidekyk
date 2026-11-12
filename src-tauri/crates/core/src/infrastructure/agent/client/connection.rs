//! One helper process: started from its command, written to through its stdin, its output read
//! by `output` into the replies its requests wait for.

use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::process::{ChildStderr, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::Sender;
use std::sync::{Arc, Mutex};

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
    /// `None` once closed: the helper reads the end of its input and exits.
    stdin: Mutex<Option<ChildStdin>>,
    pub(super) replies: Arc<Replies>,
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
        let (read_replies, kept) = (replies.clone(), kept.clone());
        std::thread::spawn(move || read_messages(stdout, &read_replies, &kept, child));
        Ok(Arc::new(Self {
            stdin: Mutex::new(Some(stdin)),
            replies,
        }))
    }

    pub(super) fn write(&self, id: u64, request: Request) -> anyhow::Result<()> {
        let mut stdin = lock(&self.stdin);
        let stdin = stdin.as_mut().context("the helper was closed")?;
        write_frame(stdin, &RequestFrame { id, request }).context("could not write to the helper")
    }

    pub(super) fn close(&self) {
        self.replies.closed.store(true, Ordering::Relaxed);
        lock(&self.stdin).take();
    }

    /// Tells a helper just started what the app keeps, as it is now: read under the lock its
    /// requests are written with, so a change told meanwhile is never told before an older state.
    pub(super) fn tell_kept(&self, kept: &Kept, next_id: &AtomicU64) -> anyhow::Result<()> {
        let mut stdin = lock(&self.stdin);
        let stdin = stdin.as_mut().context("the helper was closed")?;
        let mut tell = |request| {
            let id = next_id.fetch_add(1, Ordering::Relaxed);
            write_frame(stdin, &RequestFrame { id, request })
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

/// Each line the helper writes to its stderr, to the app's log, until it ends.
fn log_lines(stderr: ChildStderr) {
    for line in BufReader::new(stderr).lines().map_while(Result::ok) {
        log_line(&line);
    }
}
