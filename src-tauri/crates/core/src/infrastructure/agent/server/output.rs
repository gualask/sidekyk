//! What the helper writes to the app, one whole frame at a time whichever thread writes it: each
//! request's reply, an image's bytes, and the messages it sends unasked.

use std::io::{self, Write};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use serde_json::value::RawValue;

use super::super::protocol::{write_bytes, write_frame, Message, WireError};
use crate::shared::sync::lock;

/// Where every thread writes its frames, one whole frame at a time.
pub(super) type Output = Arc<Mutex<Box<dyn Write + Send>>>;

/// A request's answer, as JSON.
pub(super) type Reply = anyhow::Result<Box<RawValue>>;

pub(super) fn value(value: impl Serialize) -> Reply {
    Ok(serde_json::value::to_raw_value(&value)?)
}

/// `work`'s answer, or a failure if it panicked: the app waits for every reply.
pub(super) fn guarded<T>(work: impl FnOnce() -> anyhow::Result<T>) -> anyhow::Result<T> {
    catch_unwind(AssertUnwindSafe(work))
        .unwrap_or_else(|_| Err(anyhow::anyhow!("the helper failed on this request")))
}

pub(super) fn reply(output: &Output, id: u64, result: Reply) {
    let result = result.map_err(|error| WireError::from(&error));
    if let Err(error) = write_message(output, &Message::Reply { id, result }) {
        // the app waits for this reply: a smaller one says why it cannot have it
        if error.kind() == io::ErrorKind::InvalidInput {
            let error = WireError::from(&anyhow::anyhow!("the answer is too long to send"));
            send_message(
                output,
                &Message::Reply {
                    id,
                    result: Err(error),
                },
            );
        }
    }
}

/// An image's bytes as they are, after their message: a failure is a reply as any other.
pub(super) fn reply_image(output: &Output, id: u64, image: anyhow::Result<Vec<u8>>) {
    match image {
        Ok(bytes) => reply_bytes(output, id, &bytes),
        Err(error) => reply(output, id, Err(error)),
    }
}

/// Bytes as they are after their message; too long to send, the app gets a failure instead.
fn reply_bytes(output: &Output, id: u64, bytes: &[u8]) {
    let written = write_bytes(&mut *lock(output), &Message::Bytes { id }, bytes);
    match written {
        Err(error) if error.kind() == io::ErrorKind::InvalidInput => reply(
            output,
            id,
            Err(anyhow::anyhow!("the answer is too long to send")),
        ),
        Err(error) => tracing::debug!(%error, "could not write to the app"),
        Ok(()) => {}
    }
}

fn write_message(output: &Output, message: &Message) -> io::Result<()> {
    write_frame(&mut *lock(output), message)
}

pub(super) fn send_message(output: &Output, message: &Message) {
    // the app went away: the read loop ends on its own
    if let Err(error) = write_message(output, message) {
        tracing::debug!(%error, "could not write to the app");
    }
}
