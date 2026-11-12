//! What the helper writes: each message on its stdout to whom waits for it, until it stops; each
//! line of its stderr to the app's log.

use std::io::{self, BufRead, BufReader};
use std::process::{Child, ChildStdout};
use std::sync::atomic::Ordering;
use std::time::Instant;

use super::super::protocol::{read_bytes, read_frame, Message};
use super::connection::{Incoming, Replies};
use super::{Kept, SharedOnChange, STABLE_RUN};
use crate::modules::folder::RepositoryChange;
use crate::shared::error::UserFacingErrorCode;
use crate::shared::sync::lock;

/// Hands each message of the helper to whom waits for it, until the helper stops.
pub(super) fn read_messages(stdout: ChildStdout, replies: &Replies, kept: &Kept, mut child: Child) {
    let started = Instant::now();
    if let Err(error) = hand_messages(BufReader::new(stdout), replies, kept) {
        tracing::warn!(%error, "the helper's output cannot be read: stopping it");
        let _ = child.kill();
    }
    // before it shows as stopped, so no request starts the next one too soon
    let closed = replies.closed.load(Ordering::Relaxed);
    let stable = closed || started.elapsed() >= STABLE_RUN;
    if !stable {
        let code = UserFacingErrorCode::HelperFailed;
        *lock(&kept.not_before) = Some((Instant::now() + STABLE_RUN, code));
    }
    fail_waiting(replies);
    match child.wait() {
        Ok(status) => tracing::info!(%status, "helper stopped"),
        Err(error) => tracing::warn!(%error, "helper stopped"),
    }
    if closed || !stable {
        return;
    }
    if kept.hidden.load(Ordering::Relaxed) {
        kept.read_again.store(true, Ordering::Relaxed);
    } else {
        read_again(kept);
    }
}

/// The helper stopped: the requests waiting fail, their senders dropped, and no other waits.
fn fail_waiting(replies: &Replies) {
    let mut waiting = lock(&replies.waiting);
    replies.stopped.store(true, Ordering::Relaxed);
    waiting.clear();
}

/// The helper's messages, each to whom waits for it, until its output ends.
fn hand_messages(mut input: impl BufRead, replies: &Replies, kept: &Kept) -> io::Result<()> {
    while let Some(message) = read_frame::<Message>(&mut input)? {
        match message {
            Message::Reply { id, result } => hand_last(replies, id, Incoming::Reply(result)),
            Message::Bytes { id } => {
                let bytes = read_bytes(&mut input)?;
                hand_last(replies, id, Incoming::Bytes(bytes));
            }
            Message::Contents { id, files } => hand_part(replies, id, Incoming::Contents(files)),
            Message::Changed(change) => hand_change(kept, change),
        }
    }
    Ok(())
}

/// The last of what request `id` waits for: one nobody waits for was told, not asked.
fn hand_last(replies: &Replies, id: u64, incoming: Incoming) {
    if let Some(sender) = lock(&replies.waiting).remove(&id) {
        let _ = sender.send(incoming);
    }
}

/// A part of what request `id` waits for, which goes on waiting for the rest.
fn hand_part(replies: &Replies, id: u64, incoming: Incoming) {
    if let Some(sender) = lock(&replies.waiting).get(&id) {
        let _ = sender.send(incoming);
    }
}

/// A change of the repository at `change.root` to whom watches it.
fn hand_change(kept: &Kept, change: RepositoryChange) {
    if let Some(on_change) = watching(kept, &change.root) {
        on_change(change);
    }
}

/// What gets the changes of the repository at `root`, if it is the one watched: one the helper
/// sent before it took the next watch is not.
fn watching(kept: &Kept, root: &str) -> Option<SharedOnChange> {
    lock(&kept.watched)
        .as_ref()
        .filter(|(repository, _)| repository.root == root)
        .map(|(_, f)| f.clone())
}

/// What the helper that stopped watched may have changed meanwhile: the app reads it again, which
/// starts the next helper.
pub(super) fn read_again(kept: &Kept) {
    let watched = lock(&kept.watched).clone();
    if let Some((repository, on_change)) = watched {
        on_change(RepositoryChange::anything(repository.root.clone()));
    }
}

/// A line the helper logged, at its level in the app's log.
pub(super) fn log_line(line: &str) {
    let line = line.trim();
    match line.split_whitespace().next() {
        Some("ERROR") => tracing::error!(target: "helper", "{line}"),
        Some("WARN") => tracing::warn!(target: "helper", "{line}"),
        Some("INFO") => tracing::info!(target: "helper", "{line}"),
        // a panic writes no level: it is the helper failing, kept in every build
        _ if line.contains("panicked") => tracing::error!(target: "helper", "{line}"),
        _ => tracing::debug!(target: "helper", "{line}"),
    }
}
