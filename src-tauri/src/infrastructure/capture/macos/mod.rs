//! macOS: ScreenCaptureKit reads the display under the pointer, Sidekyk's windows left out, and a
//! non-activating panel above everything (other apps' full screen included) shows it frozen and
//! dimmed while an area is picked: drawn, moved, resized by its handles, then taken by `↵`, a
//! double click in it or its button. The area shows bright through a second layer of the same
//! frame, so a drag moves layers and repaints nothing (`.local/capture-overlay/`: on glass in
//! 63-84 ms, ~10 MB). The panel is made for one capture and dropped after it; the area last taken
//! on the same display, given by the caller, shows picked at the start. Here the display is read;
//! the panel is `macos_panel.rs`, its view `macos_view.rs`, the view's layers `macos_layers.rs`,
//! the area taken as a note's image `macos_image.rs`.

mod image;
mod layers;
mod panel;
mod view;

use std::ptr::NonNull;
use std::sync::{Arc, Mutex};

use anyhow::anyhow;
use block2::RcBlock;
use dispatch2::DispatchQueue;
use objc2::rc::Retained;
use objc2::{AllocAnyThread, MainThreadMarker};
use objc2_app_kit::{NSEvent, NSScreen};
use objc2_core_foundation::{CFRetained, CGFloat};
use objc2_core_graphics::{CGImage, CGPreflightScreenCaptureAccess, CGRequestScreenCaptureAccess};
use objc2_foundation::{ns_string, NSArray, NSError, NSNumber, NSPoint, NSRect};
use objc2_screen_capture_kit::{
    SCContentFilter, SCDisplay, SCRunningApplication, SCScreenshotManager, SCShareableContent,
    SCStreamConfiguration,
};
use sidekyk_core::modules::capture::{Area, Outcome, Taken};
use tauri::AppHandle;

use super::Done;
use panel::show;

/// Starts a capture of the display under the pointer, `confirm` its button's text; the area
/// `last` taken shows picked when it is on that display. `done` is called once it ends, even if
/// the capture cannot reach the main thread, where AppKit shows its panel. One at a time: the
/// caller's to see to.
pub(crate) fn start(app: &AppHandle, confirm: &'static str, last: Option<Taken>, done: Done) {
    let slot = Arc::new(Once(Mutex::new(Some(done))));
    let queued = slot.clone();
    let result = app.run_on_main_thread(move || {
        if let Some(done) = queued.take() {
            begin(confirm, last, done);
        }
    });
    if let Err(error) = result {
        if let Some(done) = slot.take() {
            done(Outcome::Failed(anyhow::Error::from(error)));
        }
    }
}

/// `start`, on the main thread.
fn begin(confirm: &'static str, last: Option<Taken>, done: Done) {
    let Some(mtm) = MainThreadMarker::new() else {
        return done(Outcome::Failed(anyhow!(
            "a capture starts on the main thread"
        )));
    };
    if !CGPreflightScreenCaptureAccess() {
        // the system's prompt the first time; afterwards it only answers no
        CGRequestScreenCaptureAccess();
        return done(Outcome::NoPermission);
    }
    match display_under_pointer(mtm) {
        Some(display) => {
            let last = last
                .filter(|taken| taken.display == display.id)
                .map(|taken| taken.area);
            read(display, confirm, last, done);
        }
        None => done(Outcome::Failed(anyhow!("no display under the pointer"))),
    }
}

/// A display, as AppKit places it.
#[derive(Clone, Copy)]
struct Display {
    id: u32,
    /// In points, the global space's (origin at the bottom left of the main display).
    frame: NSRect,
    scale: CGFloat,
}

fn display_under_pointer(mtm: MainThreadMarker) -> Option<Display> {
    let pointer = NSEvent::mouseLocation();
    let screens = NSScreen::screens(mtm);
    let screen = screens
        .iter()
        .find(|screen| contains(screen.frame(), pointer))
        .or_else(|| NSScreen::mainScreen(mtm))?;
    let number = screen
        .deviceDescription()
        .objectForKey(ns_string!("NSScreenNumber"))?
        .downcast::<NSNumber>()
        .ok()?;
    Some(Display {
        id: number.unsignedIntValue(),
        frame: screen.frame(),
        scale: screen.backingScaleFactor(),
    })
}

fn contains(frame: NSRect, point: NSPoint) -> bool {
    point.x >= frame.origin.x
        && point.x < frame.origin.x + frame.size.width
        && point.y >= frame.origin.y
        && point.y < frame.origin.y + frame.size.height
}

/// `done`, taken once by whichever handler ends the capture.
struct Once(Mutex<Option<Done>>);

impl Once {
    fn take(&self) -> Option<Done> {
        self.0.lock().ok()?.take()
    }
}

/// Reads the display at its pixels, Sidekyk left out, then shows the panel on the main thread,
/// `last` picked.
fn read(display: Display, confirm: &'static str, last: Option<Area>, done: Done) {
    let once = Once(Mutex::new(Some(done)));
    let listed = RcBlock::new(
        move |content: *mut SCShareableContent, error: *mut NSError| {
            let Some(done) = once.take() else { return };
            // SAFETY: ScreenCaptureKit passes valid objects or null.
            let content = unsafe { content.as_ref() };
            let Some((filter, config)) = content.and_then(|content| filter(content, &display))
            else {
                return done(Outcome::Failed(failure("the display", error)));
            };
            shoot(&filter, &config, display, confirm, last, done);
        },
    );
    // SAFETY: the handler is called once, with the content or an error.
    unsafe {
        SCShareableContent::getShareableContentExcludingDesktopWindows_onScreenWindowsOnly_completionHandler(
            false, true, &listed,
        );
    }
}

/// Takes the display's picture through `filter`, then shows the panel on the main thread, `last`
/// picked.
fn shoot(
    filter: &SCContentFilter,
    config: &SCStreamConfiguration,
    display: Display,
    confirm: &'static str,
    last: Option<Area>,
    done: Done,
) {
    let once = Once(Mutex::new(Some(done)));
    let shot = RcBlock::new(move |image: *mut CGImage, error: *mut NSError| {
        let Some(done) = once.take() else { return };
        let Some(image) = NonNull::new(image) else {
            return done(Outcome::Failed(failure("the screen", error)));
        };
        // SAFETY: a valid image, retained for the panel.
        let image = unsafe { CFRetained::retain(image) };
        DispatchQueue::main().exec_async(move || show(image, display, confirm, last, done));
    });
    // SAFETY: the filter and configuration are valid; the handler is called once.
    unsafe {
        SCScreenshotManager::captureImageWithFilter_configuration_completionHandler(
            filter,
            config,
            Some(&shot),
        );
    }
}

/// What ScreenCaptureKit said about reading `what`, or that it said nothing.
fn failure(what: &str, error: *mut NSError) -> anyhow::Error {
    // SAFETY: ScreenCaptureKit passes a valid error or null.
    match unsafe { error.as_ref() } {
        Some(error) => anyhow!("could not read {what}: {}", error.localizedDescription()),
        None => anyhow!("could not read {what}"),
    }
}

/// The display at its pixels, without Sidekyk's windows nor the pointer.
fn filter(
    content: &SCShareableContent,
    display: &Display,
) -> Option<(Retained<SCContentFilter>, Retained<SCStreamConfiguration>)> {
    // SAFETY: plain getters of objects ScreenCaptureKit gave.
    unsafe {
        let shared = content
            .displays()
            .iter()
            .find(|shared| shared.displayID() == display.id)?;
        let me = std::process::id() as i32;
        let sidekyk: Vec<Retained<SCRunningApplication>> = content
            .applications()
            .iter()
            .filter(|app| app.processID() == me)
            .collect();
        let filter = SCContentFilter::initWithDisplay_excludingApplications_exceptingWindows(
            SCContentFilter::alloc(),
            &shared,
            &NSArray::from_retained_slice(&sidekyk),
            &NSArray::new(),
        );
        Some((filter, configuration(&shared, display.scale)))
    }
}

/// The display's size in pixels at its `scale`, without the pointer.
fn configuration(shared: &SCDisplay, scale: CGFloat) -> Retained<SCStreamConfiguration> {
    let pixels = |points: isize| (points as CGFloat * scale).round() as usize;
    // SAFETY: a new configuration, and plain getters of a display ScreenCaptureKit gave.
    unsafe {
        let config = SCStreamConfiguration::new();
        config.setWidth(pixels(shared.width()));
        config.setHeight(pixels(shared.height()));
        config.setShowsCursor(false);
        config
    }
}
