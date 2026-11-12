//! A helper that watches nothing is closed once asked nothing for a while, by a thread that
//! sleeps until then or until something changes.

use std::sync::atomic::Ordering;
use std::sync::{Arc, Condvar, Mutex, PoisonError};
use std::time::{Duration, Instant};

use super::connection::Connection;
use super::Kept;
use crate::shared::sync::lock;

/// How long a helper that watches nothing lives after its last request: a pause, or the projects'
/// cards read again, never waits for a new one; a WSL distro it keeps running for that long is
/// fine (`docs/features/wsl.md`, Lifecycle).
pub(super) const IDLE_EXIT: Duration = Duration::from_secs(10 * 60);

/// When the helper was last asked something, for the thread that closes it once idle.
pub(super) struct Idle {
    after: Duration,
    pub(super) state: Mutex<IdleState>,
    /// Told when a request ends, the repository watched changes, or the client goes.
    changed: Condvar,
}

pub(super) struct IdleState {
    /// Requests waiting for their reply: a helper is not idle while one does.
    pub(super) busy: usize,
    last: Instant,
    /// The client went: the thread ends.
    pub(super) gone: bool,
}

impl Idle {
    pub(super) fn new(after: Duration) -> Self {
        Self {
            after,
            state: Mutex::new(IdleState {
                busy: 0,
                last: Instant::now(),
                gone: false,
            }),
            changed: Condvar::new(),
        }
    }

    /// Changes the state, as of now, and tells the thread.
    pub(super) fn touch(&self, change: impl FnOnce(&mut IdleState)) {
        let mut state = lock(&self.state);
        change(&mut state);
        state.last = Instant::now();
        self.changed.notify_one();
    }
}

/// Closes the helper once it has watched nothing and been asked nothing for `idle.after`. Sleeps
/// until then, or until something changes: no wake-up while there is nothing to close.
pub(super) fn close_when_idle(idle: &Idle, slot: &Mutex<Option<Arc<Connection>>>, kept: &Kept) {
    let mut state = lock(&idle.state);
    loop {
        if state.gone {
            return;
        }
        if !closable(slot, kept, &state) {
            state = idle
                .changed
                .wait(state)
                .unwrap_or_else(PoisonError::into_inner);
            continue;
        }
        let deadline = state.last + idle.after;
        let now = Instant::now();
        if now < deadline {
            state = idle
                .changed
                .wait_timeout(state, deadline - now)
                .unwrap_or_else(PoisonError::into_inner)
                .0;
            continue;
        }
        let taken = lock(slot).take();
        if let Some(connection) = taken {
            // closed with no lock held: a write stuck on a full pipe holds only its own
            drop(state);
            tracing::info!("helper idle: closing it");
            connection.close();
            state = lock(&idle.state);
        }
    }
}

/// Whether a helper runs that watches nothing and waits on no request.
fn closable(slot: &Mutex<Option<Arc<Connection>>>, kept: &Kept, state: &IdleState) -> bool {
    let running = lock(slot)
        .as_ref()
        .is_some_and(|c| !c.replies.stopped.load(Ordering::Relaxed));
    let watching = lock(&kept.watched).is_some();
    running && !watching && state.busy == 0
}
