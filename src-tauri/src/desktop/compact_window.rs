//! The compact window: the main window shrunk to one view over any app (the quick note, the
//! capture window), then back as it was. One window, one WebView: the page switches between the view and its layout,
//! kept mounted. Built where `infrastructure::window::QUICK_NOTE_BUILT`.
//!
//! A hidden webview never paints, and a window shown before its page painted shows the frame
//! before. So the window turns transparent, changes and shows, and turns opaque once the page
//! says it painted (`compact_shown`, `compact_restored`); a layout restored while the window is
//! hidden turns opaque at its next show (`.local/quick-note/README.md`). A page that never says
//! so (broken, hung) leaves it opaque by a deadline, never on screen and unseen.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{
    AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, PhysicalSize, WebviewWindow,
};

use super::compact_frame::{capture_frame, quick_note_frame, restore_frame};
use crate::infrastructure::window::{self as system, AppId};
use sidekyk_core::shared::sync::lock;

/// The event telling the page to show a view, or its layout again.
const EVENT: &str = "compact-window";

/// How long the page may take to say it painted, before the window turns opaque anyway: it
/// answers in 35-600 ms (`docs/features/quick-note.md`, Measures), so this is only for a page that
/// broke or hangs, which would leave the window on screen and unseen.
const PAINT_DEADLINE: Duration = Duration::from_millis(1500);

/// What the compact window shows.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum View {
    QuickNote,
    /// The captures of a note in the making, their marks, its text and where it goes.
    Capture,
}

/// What a view opens on: the quick note under the pointer, the capture window on a crop of
/// `image` pixels, taken on `display` (the system's id).
#[derive(Clone, Copy, Debug)]
enum Opening {
    QuickNote,
    Capture { image: (u32, u32), display: u32 },
}

impl Opening {
    fn view(self) -> View {
        match self {
            Self::QuickNote => View::QuickNote,
            Self::Capture { .. } => View::Capture,
        }
    }
}

/// What the page is asked to show (`shared/platform/compact-window.ts`).
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
enum Phase {
    /// Show the view, in a box of `width` x `height` points (the window's, unless it cannot
    /// shrink), then call `compact_shown`.
    Open { view: View, width: f64, height: f64 },
    /// Show the layout again, then call `compact_restored`.
    Close,
    /// The window asked to close (`⌘W`): the view ends as at `Esc`.
    CloseAsked,
}

/// Where the window stands.
#[derive(Default)]
enum Stage {
    #[default]
    Off,
    /// A view is open, and this is what the window was before it; `painted` once the page said
    /// so, the window opaque.
    Open {
        view: View,
        before: Before,
        painted: bool,
    },
    /// Back to its frame since then, transparent until its page painted the layout.
    Restoring(Instant),
}

/// The window before the view, to go back to.
struct Before {
    shown: bool,
    focused: bool,
    /// The app in front when the view opened, given the focus back when Sidekyk was behind it.
    front: Option<AppId>,
    size: PhysicalSize<u32>,
    position: PhysicalPosition<i32>,
    opened: Instant,
}

/// Where the window goes once the view closes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Then {
    /// The window as it was: hidden, behind the app in front, or in front.
    AsBefore,
    /// The window in front, as asked by a way of showing it (the window's shortcut, the tray,
    /// the Dock).
    InFront,
}

#[derive(Default)]
pub(crate) struct CompactWindow(Mutex<Stage>);

/// The view open, if any.
fn view_open(app: &AppHandle) -> Option<View> {
    match *lock(&app.state::<CompactWindow>().0) {
        Stage::Open { view, .. } => Some(view),
        _ => None,
    }
}

/// The quick note's global shortcut and the tray's New Note: opens the quick note, or closes it
/// when open, as `Esc`; ignored while the capture window is open.
pub(crate) fn toggle_quick_note(app: &AppHandle) {
    match view_open(app) {
        Some(View::Capture) => tracing::debug!("the capture window is open: no quick note"),
        Some(View::QuickNote) => {
            close(app, Then::AsBefore);
        }
        None => open(app, Opening::QuickNote),
    }
}

/// A way of showing the window (its shortcut, the tray's Show, the Dock) while a view is open:
/// the quick note gives way to the layout, in front; the capture window stays, in front. Says
/// whether a view was open.
pub(crate) fn on_show_request(app: &AppHandle) -> bool {
    match view_open(app) {
        Some(View::Capture) => {
            system::bring_back(app);
            true
        }
        Some(View::QuickNote) => close(app, Then::InFront),
        None => false,
    }
}

/// The window asked to close (`⌘W`) while a view is open: the quick note closes; the capture
/// window is told, and ends as at `Esc`, asking first when its draft has marks or text. Says
/// whether a view was open.
pub(crate) fn on_close_request(app: &AppHandle) -> bool {
    match view_open(app) {
        Some(View::Capture) => {
            tell(app, Phase::CloseAsked);
            true
        }
        Some(View::QuickNote) => close(app, Then::AsBefore),
        None => false,
    }
}

/// A capture starts: the quick note open closes as `Esc` (its draft kept); the capture window
/// stays, for the capture to join its draft.
pub(crate) fn close_for_capture(app: &AppHandle) {
    if view_open(app) == Some(View::QuickNote) {
        close(app, Then::AsBefore);
    }
}

/// An area taken, of `image` pixels on `display`: the capture window opens fitted to it, on that
/// display, unless it is open.
pub(crate) fn open_capture(app: &AppHandle, image: (u32, u32), display: u32) {
    open(app, Opening::Capture { image, display });
}

/// Opens the view of `opening`, unless a view is open.
fn open(app: &AppHandle, opening: Opening) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    // read before the lock: off the main thread a getter waits for it
    let before = before(&window);
    let state = app.state::<CompactWindow>();
    let mut stage = lock(&state.0);
    if matches!(*stage, Stage::Open { .. }) {
        return;
    }
    system::set_opacity(&window, 0.0);
    let LogicalSize { width, height } = match opening {
        Opening::QuickNote => quick_note_frame(app, &window),
        Opening::Capture { image, display } => capture_frame(app, &window, image, display),
    };
    let view = opening.view();
    let opened = before.opened;
    *stage = Stage::Open {
        view,
        before,
        painted: false,
    };
    drop(stage);
    // shown at once, transparent: its page paints only once on screen
    system::bring_back(app);
    tell(
        app,
        Phase::Open {
            view,
            width,
            height,
        },
    );
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

/// Closes the view open, if any, and says whether one was.
pub(crate) fn close(app: &AppHandle, then: Then) -> bool {
    let Some(window) = app.get_webview_window("main") else {
        return false;
    };
    let state = app.state::<CompactWindow>();
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
        "compact view closed"
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

/// From the window before the view: on screen, in front, and the app in front then.
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
                tracing::debug!("the app in front before the view did not come back");
            }
        }
        Back::Hidden => system::hide(app),
    }
}

/// The page painted the view: it shows.
pub(crate) fn shown(app: &AppHandle) {
    let state = app.state::<CompactWindow>();
    let mut stage = lock(&state.0);
    if let (
        Stage::Open {
            before, painted, ..
        },
        Some(window),
    ) = (&mut *stage, app.get_webview_window("main"))
    {
        *painted = true;
        system::set_opacity(&window, 1.0);
        tracing::debug!(
            ms = before.opened.elapsed().as_millis(),
            "compact view shown"
        );
    }
}

/// The page painted its layout again: the window shows it. A view opened meanwhile is left alone.
pub(crate) fn restored(app: &AppHandle) {
    let state = app.state::<CompactWindow>();
    let mut stage = lock(&state.0);
    if !matches!(*stage, Stage::Restoring(_)) {
        return;
    }
    *stage = Stage::Off;
    if let Some(window) = app.get_webview_window("main") {
        system::set_opacity(&window, 1.0);
    }
}

/// A page loaded again (a crashed webview) knows no view: the window goes back to its frame,
/// opaque, so it never stays unseen.
pub(crate) fn forget(app: &AppHandle) {
    let state = app.state::<CompactWindow>();
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
/// started (the view opened, or closed) by then; a later open or close has its own.
fn opaque_by_deadline(app: &AppHandle, since: Instant) {
    let handle = app.clone();
    let spawned = std::thread::Builder::new()
        .name("compact-paint".to_string())
        .spawn(move || {
            std::thread::sleep(PAINT_DEADLINE);
            let state = handle.state::<CompactWindow>();
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
        tracing::warn!(%error, "no deadline for the compact view: it waits for its page");
    }
}

/// Whether the page has still not painted what started at `since`.
fn late(stage: &Stage, since: Instant) -> bool {
    match stage {
        Stage::Open {
            before, painted, ..
        } => !painted && before.opened == since,
        Stage::Restoring(closed) => *closed == since,
        Stage::Off => false,
    }
}

fn tell(app: &AppHandle, phase: Phase) {
    if let Err(error) = app.emit(EVENT, phase) {
        tracing::warn!(%error, ?phase, "could not tell the page about the compact view");
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
            view: View::QuickNote,
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
    fn the_page_reads_what_it_is_asked_to_show() {
        let json = |phase| serde_json::to_string(&phase).unwrap();
        assert_eq!(
            json(Phase::Open {
                view: View::Capture,
                width: 732.0,
                height: 532.5,
            }),
            r#"{"kind":"open","view":"capture","width":732.0,"height":532.5}"#
        );
        assert_eq!(
            json(Phase::Open {
                view: View::QuickNote,
                width: 560.0,
                height: 168.0,
            }),
            r#"{"kind":"open","view":"quickNote","width":560.0,"height":168.0}"#
        );
        assert_eq!(json(Phase::Close), r#"{"kind":"close"}"#);
        assert_eq!(json(Phase::CloseAsked), r#"{"kind":"closeAsked"}"#);
    }

    #[test]
    fn a_way_of_showing_the_window_leaves_it_in_front() {
        assert_eq!(
            back_to(false, false, Some("terminal"), Then::InFront),
            Back::InFront
        );
    }
}
