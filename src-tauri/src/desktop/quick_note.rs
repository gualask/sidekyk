//! The quick note: the main window shrunk to a field for the Inbox, opened from the global
//! shortcut or the tray over any app, then back as it was. Built where
//! `infrastructure::window::QUICK_NOTE_BUILT`.
//!
//! A hidden webview never paints, and a window shown before its page painted shows the frame
//! before. So the window turns transparent, changes and shows, and turns opaque once the page
//! says it painted (`quick_note_shown`, `quick_note_restored`); a layout restored while the
//! window is hidden turns opaque at its next show (`.local/quick-note/README.md`). A page that
//! never says so (broken, hung) leaves it opaque by a deadline, never on screen and unseen.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewWindow};

use super::quick_note_frame::{quick_note_frame, restore_frame};
use crate::infrastructure::window::{self as system, AppId};
use sidekyk_core::shared::sync::lock;

/// The event telling the page to show the quick note, or its layout again.
const EVENT: &str = "quick-note";

/// How long the page may take to say it painted, before the window turns opaque anyway: it
/// answers in 35-600 ms (`docs/features/quick-note.md`, Measures), so this is only for a page that
/// broke or hangs, which would leave the window on screen and unseen.
const PAINT_DEADLINE: Duration = Duration::from_millis(1500);

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
enum Phase {
    /// Show the quick note, then call `quick_note_shown`.
    Open,
    /// Show the layout again, then call `quick_note_restored`.
    Close,
}

/// Where the window stands.
#[derive(Default)]
enum Stage {
    #[default]
    Off,
    /// The quick note is open, and this is what the window was before it; `painted` once the page
    /// said so, the window opaque.
    Open { before: Before, painted: bool },
    /// Back to its frame since then, transparent until its page painted the layout.
    Restoring(Instant),
}

/// The window before the quick note, to go back to.
struct Before {
    shown: bool,
    focused: bool,
    /// The app in front at the shortcut, given the focus back when Sidekyk was behind it.
    front: Option<AppId>,
    size: PhysicalSize<u32>,
    position: PhysicalPosition<i32>,
    opened: Instant,
}

/// Where the quick note goes once closed.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Then {
    /// The window as it was: hidden, behind the app in front, or in front.
    AsBefore,
    /// The window in front, as asked by a way of showing it (the window's shortcut, the tray,
    /// the Dock).
    InFront,
}

#[derive(Default)]
pub(crate) struct QuickNoteState(Mutex<Stage>);

/// The global shortcut and the tray: opens the quick note, or closes it when open, as `Esc`.
pub(crate) fn toggle(app: &AppHandle) {
    if !close(app, Then::AsBefore) {
        open(app);
    }
}

fn open(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    // read before the lock: off the main thread a getter waits for it
    let before = before(&window);
    let state = app.state::<QuickNoteState>();
    let mut stage = lock(&state.0);
    if matches!(*stage, Stage::Open { .. }) {
        return;
    }
    system::set_opacity(&window, 0.0);
    quick_note_frame(app, &window);
    let opened = before.opened;
    *stage = Stage::Open {
        before,
        painted: false,
    };
    drop(stage);
    // shown at once, transparent: its page paints only once on screen
    system::bring_back(app);
    tell(app, Phase::Open);
    opaque_by_deadline(app, opened);
}

/// The window as it is, opened now.
fn before(window: &WebviewWindow) -> Before {
    let shown = window.is_visible().unwrap_or(false) && !window.is_minimized().unwrap_or(false);
    Before {
        shown,
        focused: shown && window.is_focused().unwrap_or(false),
        front: system::front_app(),
        size: window.inner_size().unwrap_or_default(),
        position: window.outer_position().unwrap_or_default(),
        opened: Instant::now(),
    }
}

/// Closes the quick note, if open, and says whether it was.
pub(crate) fn close(app: &AppHandle, then: Then) -> bool {
    let Some(window) = app.get_webview_window("main") else {
        return false;
    };
    let state = app.state::<QuickNoteState>();
    let mut stage = lock(&state.0);
    let Stage::Open { before, .. } = std::mem::take(&mut *stage) else {
        return false;
    };
    system::set_opacity(&window, 0.0);
    restore_frame(app, &window, before.size, before.position);
    go_back(
        app,
        back_to(before.shown, before.focused, before.front, then),
    );
    let closed = Instant::now();
    *stage = Stage::Restoring(closed);
    drop(stage);
    tracing::debug!(
        ms = before.opened.elapsed().as_millis(),
        ?then,
        "quick note closed"
    );
    tell(app, Phase::Close);
    opaque_by_deadline(app, closed);
    true
}

/// Where the window goes back to.
#[derive(Debug, PartialEq, Eq)]
enum Back<App> {
    InFront,
    /// On screen behind this app, given the focus back.
    Behind(App),
    Hidden,
}

/// From the window before the quick note: on screen, in front, and the app in front then.
fn back_to<App>(shown: bool, focused: bool, front: Option<App>, then: Then) -> Back<App> {
    if then == Then::InFront || focused {
        return Back::InFront;
    }
    if !shown {
        return Back::Hidden;
    }
    // with no app known, Sidekyk keeps the focus
    front.map_or(Back::InFront, Back::Behind)
}

/// Puts the window where it goes back to.
fn go_back(app: &AppHandle, back: Back<AppId>) {
    match back {
        Back::InFront => {}
        Back::Behind(front) => {
            if !system::activate(front) {
                tracing::debug!("the app in front before the quick note did not come back");
            }
        }
        Back::Hidden => system::hide(app),
    }
}

/// The page painted the quick note: it shows.
pub(crate) fn shown(app: &AppHandle) {
    let state = app.state::<QuickNoteState>();
    let mut stage = lock(&state.0);
    if let (Stage::Open { before, painted }, Some(window)) =
        (&mut *stage, app.get_webview_window("main"))
    {
        *painted = true;
        system::set_opacity(&window, 1.0);
        tracing::debug!(ms = before.opened.elapsed().as_millis(), "quick note shown");
    }
}

/// The page painted its layout again: the window shows it. A quick note opened meanwhile is left
/// alone.
pub(crate) fn restored(app: &AppHandle) {
    let state = app.state::<QuickNoteState>();
    let mut stage = lock(&state.0);
    if !matches!(*stage, Stage::Restoring(_)) {
        return;
    }
    *stage = Stage::Off;
    if let Some(window) = app.get_webview_window("main") {
        system::set_opacity(&window, 1.0);
    }
}

/// A page loaded again (a crashed webview) knows no quick note: the window goes back to its
/// frame, opaque, so it never stays unseen.
pub(crate) fn forget(app: &AppHandle) {
    let state = app.state::<QuickNoteState>();
    let mut stage = lock(&state.0);
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    match std::mem::take(&mut *stage) {
        Stage::Off => return,
        Stage::Open { before, .. } => restore_frame(app, &window, before.size, before.position),
        Stage::Restoring(_) => {}
    }
    system::set_opacity(&window, 1.0);
}

/// Turns the window opaque at the deadline if the page has not said it painted what `since`
/// started (the note opened, or closed) by then; a later open or close has its own.
fn opaque_by_deadline(app: &AppHandle, since: Instant) {
    let handle = app.clone();
    let spawned = std::thread::Builder::new()
        .name("quick-note-paint".to_string())
        .spawn(move || {
            std::thread::sleep(PAINT_DEADLINE);
            let state = handle.state::<QuickNoteState>();
            let mut stage = lock(&state.0);
            if !late(&stage, since) {
                return;
            }
            if matches!(*stage, Stage::Restoring(_)) {
                *stage = Stage::Off;
            }
            if let Some(window) = handle.get_webview_window("main") {
                system::set_opacity(&window, 1.0);
            }
            tracing::warn!("the page did not paint in time: the window turned opaque anyway");
        });
    if let Err(error) = spawned {
        tracing::warn!(%error, "no deadline for the quick note: it waits for its page");
    }
}

/// Whether the page has still not painted what started at `since`.
fn late(stage: &Stage, since: Instant) -> bool {
    match stage {
        Stage::Open { before, painted } => !painted && before.opened == since,
        Stage::Restoring(closed) => *closed == since,
        Stage::Off => false,
    }
}

fn tell(app: &AppHandle, phase: Phase) {
    if let Err(error) = app.emit(EVENT, phase) {
        tracing::warn!(%error, ?phase, "could not tell the page about the quick note");
        // the page never answers: the window, shown, must not stay unseen
        forget(app);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_window_goes_back_as_it_was() {
        let terminal = Some("terminal");
        // in front, hidden or minimized, behind another app
        assert_eq!(back_to(true, true, terminal, Then::AsBefore), Back::InFront);
        assert_eq!(
            back_to(false, false, terminal, Then::AsBefore),
            Back::Hidden
        );
        assert_eq!(
            back_to(true, false, terminal, Then::AsBefore),
            Back::Behind("terminal")
        );
        assert_eq!(
            back_to(true, false, None::<&str>, Then::AsBefore),
            Back::InFront
        );
    }

    #[test]
    fn the_deadline_counts_only_while_the_page_has_not_painted_what_it_waits_for() {
        let opened = Instant::now();
        let open = |painted| Stage::Open {
            before: Before {
                shown: false,
                focused: false,
                front: None,
                size: PhysicalSize::default(),
                position: PhysicalPosition::default(),
                opened,
            },
            painted,
        };
        assert!(late(&open(false), opened));
        assert!(!late(&open(true), opened));
        let closed = Instant::now() + Duration::from_millis(1);
        assert!(late(&Stage::Restoring(closed), closed));
        // another open or close since, which has a deadline of its own
        assert!(!late(&open(false), closed));
        assert!(!late(&Stage::Restoring(closed), opened));
        assert!(!late(&Stage::Off, opened));
    }

    #[test]
    fn a_way_of_showing_the_window_leaves_it_in_front() {
        assert_eq!(
            back_to(false, false, Some("terminal"), Then::InFront),
            Back::InFront
        );
    }
}
