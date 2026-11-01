//! macOS: ScreenCaptureKit reads the display under the pointer, Sidekyk's windows left out, and a
//! non-activating panel above everything (other apps' full screen included) shows it frozen and
//! dimmed while an area is picked: drawn, moved, resized by its handles, then taken by `↵`, a
//! double click in it or its button. The area shows bright through a second layer of the same
//! frame, so a drag moves layers and repaints nothing (`.local/capture-overlay/`: on glass in
//! 63-84 ms, ~10 MB). The panel is made for one capture and dropped after it; the area taken
//! comes back at the next capture on the same display, for this session.

use std::cell::{Cell, RefCell};
use std::ffi::c_void;
use std::ptr::NonNull;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use anyhow::anyhow;
use block2::RcBlock;
use dispatch2::DispatchQueue;
use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2::{
    available, define_class, msg_send, AllocAnyThread, DefinedClass, MainThreadMarker,
    MainThreadOnly,
};
use objc2_app_kit::{
    NSBackingStoreType, NSCursor, NSCursorFrameResizeDirections, NSCursorFrameResizePosition,
    NSEvent, NSFont, NSFontWeight, NSFontWeightMedium, NSFontWeightSemibold, NSPanel, NSResponder,
    NSScreen, NSScreenSaverWindowLevel, NSTrackingArea, NSTrackingAreaOptions, NSView, NSWindow,
    NSWindowCollectionBehavior, NSWindowStyleMask,
};
use objc2_core_foundation::{CFRetained, CFType, CGFloat, CGPoint, CGRect, CGSize};
use objc2_core_graphics::{
    kCGColorSpaceSRGB, CGBitmapContextCreate, CGColor, CGColorSpace, CGContext, CGImage,
    CGImageAlphaInfo, CGImageByteOrderInfo, CGPreflightScreenCaptureAccess,
    CGRequestScreenCaptureAccess,
};
use objc2_foundation::{ns_string, NSArray, NSError, NSNumber, NSPoint, NSRect, NSString};
use objc2_quartz_core::{CALayer, CATextLayer, CATransaction};
use objc2_screen_capture_kit::{
    SCContentFilter, SCRunningApplication, SCScreenshotManager, SCShareableContent,
    SCStreamConfiguration,
};

use super::{Done, Outcome};
use sidekyk_core::modules::capture::{Area, Grip, Handle, Point, Selection, Size};
use sidekyk_core::modules::notes::{prepare_capture, PreparedImage};

/// Key codes: `Esc`, `↵` and the keypad's Enter.
const ESCAPE: u16 = 53;
const RETURN: u16 = 36;
const ENTER: u16 = 76;
/// How dark the frame shows around the area.
const DIM: CGFloat = 0.35;
/// The size label's and the button's padding and type size, and the gap between them, in points.
const LABEL_PAD: (CGFloat, CGFloat) = (6.0, 3.0);
const LABEL_TYPE: CGFloat = 12.0;
const BUTTON_PAD: (CGFloat, CGFloat) = (12.0, 5.0);
const BUTTON_TYPE: CGFloat = 13.0;
const BAR_GAP: CGFloat = 8.0;
/// The app's accent, `--ui-accent` (#6366f1, the same in both themes): the button's.
const ACCENT: (CGFloat, CGFloat, CGFloat) = (99.0 / 255.0, 102.0 / 255.0, 241.0 / 255.0);
/// A handle's diameter, in points.
const HANDLE: CGFloat = 8.0;
/// The area's border and the handles' outline: widths in points, white and black opacities.
const BORDER: (CGFloat, CGFloat) = (1.0, 0.9);
const HANDLE_OUTLINE: (CGFloat, CGFloat) = (0.5, 0.4);
/// The size label's black opacity, and the label's and the button's corner radii, in points.
const LABEL_SHADE: CGFloat = 0.7;
const LABEL_RADIUS: CGFloat = 4.0;
const BUTTON_RADIUS: CGFloat = 6.0;
/// The button's shadow: opacity, blur radius and downward offset in points.
const BUTTON_SHADOW: (f32, CGFloat, CGFloat) = (0.35, 6.0, 2.0);

/// A capture is on, from its start until its panel closes: another start is ignored.
static CAPTURING: AtomicBool = AtomicBool::new(false);

thread_local! {
    /// The panel on screen, kept until the capture ends.
    static PANEL: RefCell<Option<Retained<OverlayPanel>>> = const { RefCell::new(None) };
    /// The area last taken, and its display's id.
    static LAST: Cell<Option<(u32, Area)>> = const { Cell::new(None) };
}

/// Starts a capture of the display under the pointer, `confirm` its button's text; `done` is
/// called once it ends, unless this returns false: a capture was already on. Called on the main
/// thread.
pub(crate) fn start(confirm: &'static str, done: Done) -> bool {
    let Some(mtm) = MainThreadMarker::new() else {
        done(Outcome::Failed(anyhow!(
            "a capture starts on the main thread"
        )));
        return true;
    };
    if CAPTURING.swap(true, Ordering::SeqCst) {
        if PANEL.with(|panel| panel.borrow().is_none()) {
            // ScreenCaptureKit has not answered the last start: it always should
            tracing::warn!("a capture is still reading the screen");
        }
        return false;
    }
    if !CGPreflightScreenCaptureAccess() {
        // the system's prompt the first time; afterwards it only answers no
        CGRequestScreenCaptureAccess();
        end(done, Outcome::NoPermission);
        return true;
    }
    match display_under_pointer(mtm) {
        Some(display) => read(display, confirm, done),
        None => end(
            done,
            Outcome::Failed(anyhow!("no display under the pointer")),
        ),
    }
    true
}

/// Ends a capture that never showed its panel.
fn end(done: Done, outcome: Outcome) {
    CAPTURING.store(false, Ordering::SeqCst);
    done(outcome);
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

/// Reads the display at its pixels, Sidekyk left out, then shows the panel on the main thread.
fn read(display: Display, confirm: &'static str, done: Done) {
    let once = Once(Mutex::new(Some(done)));
    let listed = RcBlock::new(
        move |content: *mut SCShareableContent, error: *mut NSError| {
            let Some(done) = once.take() else { return };
            // SAFETY: ScreenCaptureKit passes valid objects or null.
            let content = unsafe { content.as_ref() };
            let Some((filter, config)) = content.and_then(|content| filter(content, &display))
            else {
                return end(done, Outcome::Failed(failure("the display", error)));
            };
            let once = Once(Mutex::new(Some(done)));
            let shot = RcBlock::new(move |image: *mut CGImage, error: *mut NSError| {
                let Some(done) = once.take() else { return };
                let Some(image) = NonNull::new(image) else {
                    return end(done, Outcome::Failed(failure("the screen", error)));
                };
                // SAFETY: a valid image, retained for the panel.
                let image = unsafe { CFRetained::retain(image) };
                DispatchQueue::main().exec_async(move || show(image, display, confirm, done));
            });
            // SAFETY: the filter and configuration are valid; the handler is called once.
            unsafe {
                SCScreenshotManager::captureImageWithFilter_configuration_completionHandler(
                    &filter,
                    &config,
                    Some(&shot),
                );
            }
        },
    );
    // SAFETY: the handler is called once, with the content or an error.
    unsafe {
        SCShareableContent::getShareableContentExcludingDesktopWindows_onScreenWindowsOnly_completionHandler(
            false, true, &listed,
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
        let config = SCStreamConfiguration::new();
        let pixels = |points: isize| (points as CGFloat * display.scale).round() as usize;
        config.setWidth(pixels(shared.width()));
        config.setHeight(pixels(shared.height()));
        config.setShowsCursor(false);
        Some((filter, config))
    }
}

/// Puts the panel up over the display, holding the frame. On the main thread.
fn show(image: CFRetained<CGImage>, display: Display, confirm: &'static str, done: Done) {
    let mtm = MainThreadMarker::new().expect("the main queue runs on the main thread");
    let panel = OverlayPanel::new(mtm, image, display, confirm, done);
    panel.orderFrontRegardless();
    panel.makeKeyWindow();
    NSCursor::crosshairCursor().set();
    PANEL.with(|slot| *slot.borrow_mut() = Some(panel));
}

define_class!(
    /// A borderless panel that takes the keyboard without making Sidekyk the active app.
    #[unsafe(super(NSPanel, NSWindow, NSResponder, objc2_foundation::NSObject))]
    #[thread_kind = MainThreadOnly]
    #[name = "SidekykCapturePanel"]
    struct OverlayPanel;

    impl OverlayPanel {
        #[unsafe(method(canBecomeKeyWindow))]
        fn can_become_key_window(&self) -> bool {
            true
        }
    }
);

impl OverlayPanel {
    fn new(
        mtm: MainThreadMarker,
        image: CFRetained<CGImage>,
        display: Display,
        confirm: &'static str,
        done: Done,
    ) -> Retained<Self> {
        // SAFETY: NSPanel's designated initializer; released by `PANEL`, not when closed.
        let panel: Retained<Self> = unsafe {
            msg_send![
                Self::alloc(mtm),
                initWithContentRect: display.frame,
                styleMask: NSWindowStyleMask::Borderless | NSWindowStyleMask::NonactivatingPanel,
                backing: NSBackingStoreType::Buffered,
                defer: false,
            ]
        };
        // SAFETY: the panel is kept by `PANEL`, never released on close.
        unsafe { panel.setReleasedWhenClosed(false) };
        panel.setLevel(NSScreenSaverWindowLevel);
        panel.setCollectionBehavior(
            NSWindowCollectionBehavior::CanJoinAllSpaces
                | NSWindowCollectionBehavior::FullScreenAuxiliary
                | NSWindowCollectionBehavior::Stationary,
        );
        panel.setHidesOnDeactivate(false);
        panel.setHasShadow(false);
        panel.setOpaque(true);
        let view = OverlayView::new(mtm, image, display, confirm, done);
        panel.setContentView(Some(&view));
        panel.makeFirstResponder(Some(&view));
        panel
    }
}

struct ViewState {
    image: CFRetained<CGImage>,
    display: u32,
    scale: CGFloat,
    /// The display's size, in points.
    size: Size,
    selection: RefCell<Selection>,
    /// The frame again, bright, shown over the dimmed one in the area.
    bright: Retained<CALayer>,
    handles: Vec<(Handle, Retained<CALayer>)>,
    label: Retained<CALayer>,
    text: Retained<CATextLayer>,
    button: Retained<CALayer>,
    /// Where the button is, while it shows.
    button_frame: Cell<Option<CGRect>>,
    done: RefCell<Option<Done>>,
}

define_class!(
    /// The frozen frame, dimmed, and the area picked over it.
    #[unsafe(super(NSView, NSResponder, objc2_foundation::NSObject))]
    #[thread_kind = MainThreadOnly]
    #[name = "SidekykCaptureView"]
    #[ivars = ViewState]
    struct OverlayView;

    impl OverlayView {
        /// Points from the top left, as the core's geometry and the layers below.
        #[unsafe(method(isFlipped))]
        fn is_flipped(&self) -> bool {
            true
        }

        #[unsafe(method(acceptsFirstResponder))]
        fn accepts_first_responder(&self) -> bool {
            true
        }

        #[unsafe(method(acceptsFirstMouse:))]
        fn accepts_first_mouse(&self, _event: Option<&NSEvent>) -> bool {
            true
        }

        #[unsafe(method(mouseMoved:))]
        fn mouse_moved(&self, event: &NSEvent) {
            self.point_at(self.point(event));
        }

        #[unsafe(method(mouseDown:))]
        fn mouse_down(&self, event: &NSEvent) {
            let at = self.point(event);
            let on_area = self.ivars().selection.borrow().grip(at) == Grip::Move;
            if self.on_button(at) || (event.clickCount() >= 2 && on_area) {
                return self.confirm();
            }
            self.ivars().selection.borrow_mut().press(at);
            self.draw();
            self.point_at(at);
        }

        #[unsafe(method(mouseDragged:))]
        fn mouse_dragged(&self, event: &NSEvent) {
            let changed = self
                .ivars()
                .selection
                .borrow_mut()
                .drag_to(self.point(event));
            if changed {
                self.draw();
            }
        }

        #[unsafe(method(mouseUp:))]
        fn mouse_up(&self, event: &NSEvent) {
            self.ivars().selection.borrow_mut().release();
            self.draw();
            self.point_at(self.point(event));
        }

        #[unsafe(method(keyDown:))]
        fn key_down(&self, event: &NSEvent) {
            match event.keyCode() {
                ESCAPE => self.finish(None),
                RETURN | ENTER => self.confirm(),
                _ => {}
            }
        }
    }
);

impl OverlayView {
    fn new(
        mtm: MainThreadMarker,
        image: CFRetained<CGImage>,
        display: Display,
        confirm: &'static str,
        done: Done,
    ) -> Retained<Self> {
        let size = Size {
            width: display.frame.size.width,
            height: display.frame.size.height,
        };
        let bounds = CGRect::new(CGPoint::ZERO, CGSize::new(size.width, size.height));
        let contents: &AnyObject = AsRef::<CFType>::as_ref(&*image).as_ref();

        let root = CALayer::new();
        root.setGeometryFlipped(true);
        // SAFETY: an image is what a layer's contents take.
        unsafe { root.setContents(Some(contents)) };
        let dim = CALayer::new();
        dim.setFrame(bounds);
        dim.setBackgroundColor(Some(&CGColor::new_generic_gray(0.0, DIM)));
        root.addSublayer(&dim);

        let bright = CALayer::new();
        // SAFETY: as above.
        unsafe { bright.setContents(Some(contents)) };
        bright.setBorderWidth(BORDER.0);
        bright.setBorderColor(Some(&CGColor::new_generic_gray(1.0, BORDER.1)));
        bright.setHidden(true);
        root.addSublayer(&bright);

        let handles = Handle::ALL
            .into_iter()
            .map(|handle| {
                let layer = CALayer::new();
                layer.setBounds(CGRect::new(CGPoint::ZERO, CGSize::new(HANDLE, HANDLE)));
                layer.setCornerRadius(HANDLE / 2.0);
                layer.setBackgroundColor(Some(&CGColor::new_generic_gray(1.0, 1.0)));
                layer.setBorderWidth(HANDLE_OUTLINE.0);
                layer.setBorderColor(Some(&CGColor::new_generic_gray(0.0, HANDLE_OUTLINE.1)));
                layer.setHidden(true);
                root.addSublayer(&layer);
                (handle, layer)
            })
            .collect();

        // SAFETY: the system's constants.
        let (medium, semibold) = unsafe { (NSFontWeightMedium, NSFontWeightSemibold) };
        let (label, text) = pill(
            display.scale,
            &CGColor::new_generic_gray(0.0, LABEL_SHADE),
            LABEL_TYPE,
            medium,
        );
        root.addSublayer(&label);
        // the primary action: the app's accent, white, larger, `↵` named on it
        let (button, button_text) = pill(
            display.scale,
            &CGColor::new_srgb(ACCENT.0, ACCENT.1, ACCENT.2, 1.0),
            BUTTON_TYPE,
            semibold,
        );
        button.setCornerRadius(BUTTON_RADIUS);
        button.setShadowColor(Some(&CGColor::new_generic_gray(0.0, 1.0)));
        button.setShadowOpacity(BUTTON_SHADOW.0);
        button.setShadowRadius(BUTTON_SHADOW.1);
        button.setShadowOffset(CGSize::new(0.0, BUTTON_SHADOW.2));
        let confirm = NSString::from_str(&format!("{confirm}  ↵"));
        // SAFETY: a string is what a text layer shows.
        unsafe { button_text.setString(Some(&confirm)) };
        let fit = button_text.preferredFrameSize();
        button_text.setFrame(CGRect::new(CGPoint::new(BUTTON_PAD.0, BUTTON_PAD.1), fit));
        button.setBounds(CGRect::new(
            CGPoint::ZERO,
            CGSize::new(
                fit.width + 2.0 * BUTTON_PAD.0,
                fit.height + 2.0 * BUTTON_PAD.1,
            ),
        ));
        root.addSublayer(&button);

        let remembered = LAST
            .with(Cell::get)
            .and_then(|(id, area)| (id == display.id).then_some(area));
        let state = ViewState {
            image,
            display: display.id,
            scale: display.scale,
            size,
            selection: RefCell::new(Selection::new(size, remembered)),
            bright,
            handles,
            label,
            text,
            button,
            button_frame: Cell::new(None),
            done: RefCell::new(Some(done)),
        };
        let this = Self::alloc(mtm).set_ivars(state);
        // SAFETY: NSView's designated initializer.
        let view: Retained<Self> = unsafe { msg_send![super(this), initWithFrame: bounds] };
        // a layer-hosting view: the layers are ours to arrange
        view.setLayer(Some(&root));
        view.setWantsLayer(true);
        // the pointer's shape follows what a press would do
        // SAFETY: the view owns the area, and outlives it.
        let tracking = unsafe {
            NSTrackingArea::initWithRect_options_owner_userInfo(
                NSTrackingArea::alloc(),
                bounds,
                NSTrackingAreaOptions::MouseMoved
                    | NSTrackingAreaOptions::ActiveAlways
                    | NSTrackingAreaOptions::InVisibleRect,
                Some(&view),
                None,
            )
        };
        view.addTrackingArea(&tracking);
        view.draw();
        view
    }

    fn point(&self, event: &NSEvent) -> Point {
        let point = self.convertPoint_fromView(event.locationInWindow(), None);
        Point {
            x: point.x,
            y: point.y,
        }
    }

    fn on_button(&self, at: Point) -> bool {
        self.ivars().button_frame.get().is_some_and(|frame| {
            at.x >= frame.origin.x
                && at.x <= frame.origin.x + frame.size.width
                && at.y >= frame.origin.y
                && at.y <= frame.origin.y + frame.size.height
        })
    }

    /// The pointer's shape for what a press here does, or the drag under way does.
    fn point_at(&self, at: Point) {
        let selection = self.ivars().selection.borrow();
        let cursor = match selection.dragging() {
            Some(Grip::Move) => NSCursor::closedHandCursor(),
            Some(grip) => grip_cursor(grip),
            None if self.on_button(at) => NSCursor::pointingHandCursor(),
            None => match selection.grip(at) {
                Grip::Move => NSCursor::openHandCursor(),
                grip => grip_cursor(grip),
            },
        };
        cursor.set();
    }

    /// The area as picked: bright with its border and handles, its size beside it and, once no
    /// drag changes it, the button that takes it; nothing while none is. No animation.
    fn draw(&self) {
        let state = self.ivars();
        let selection = state.selection.borrow();
        CATransaction::begin();
        CATransaction::setDisableActions(true);
        let area = selection.area();
        state.bright.setHidden(area.is_none());
        state.label.setHidden(area.is_none());
        for (_, handle) in &state.handles {
            handle.setHidden(area.is_none());
        }
        let picked = selection.picked().is_some();
        state.button.setHidden(!picked);
        state.button_frame.set(None);
        if let Some(area) = area {
            state.bright.setFrame(rect(area));
            state.bright.setContentsRect(CGRect::new(
                CGPoint::new(area.x / state.size.width, area.y / state.size.height),
                CGSize::new(
                    area.width / state.size.width,
                    area.height / state.size.height,
                ),
            ));
            for (handle, layer) in &state.handles {
                let at = area.handle_point(*handle);
                layer.setPosition(CGPoint::new(at.x, at.y));
            }
            let label = NSString::from_str(&area.label(state.scale, self.frame_pixels()));
            // SAFETY: a string is what a text layer shows.
            unsafe { state.text.setString(Some(&label)) };
            let text = state.text.preferredFrameSize();
            let label_size = CGSize::new(
                text.width + 2.0 * LABEL_PAD.0,
                text.height + 2.0 * LABEL_PAD.1,
            );
            let button = state.button.bounds().size;
            // the label, then the button, centered on one line
            let bar = if picked {
                Size {
                    width: label_size.width + BAR_GAP + button.width,
                    height: label_size.height.max(button.height),
                }
            } else {
                Size {
                    width: label_size.width,
                    height: label_size.height,
                }
            };
            let origin = area.label_origin(bar, state.size);
            let middle = |height: CGFloat| origin.y + (bar.height - height) / 2.0;
            state.label.setFrame(CGRect::new(
                CGPoint::new(origin.x, middle(label_size.height)),
                label_size,
            ));
            state
                .text
                .setFrame(CGRect::new(CGPoint::new(LABEL_PAD.0, LABEL_PAD.1), text));
            if picked {
                let frame = CGRect::new(
                    CGPoint::new(origin.x + label_size.width + BAR_GAP, middle(button.height)),
                    button,
                );
                state.button.setFrame(frame);
                state.button_frame.set(Some(frame));
            }
        }
        CATransaction::commit();
    }

    /// The frozen frame's size, in pixels.
    fn frame_pixels(&self) -> (u32, u32) {
        let image = &self.ivars().image;
        (
            CGImage::width(Some(image)) as u32,
            CGImage::height(Some(image)) as u32,
        )
    }

    /// Takes the area picked, if one is, and remembers it for the next capture.
    fn confirm(&self) {
        let picked = self.ivars().selection.borrow().picked();
        if let Some(area) = picked {
            LAST.with(|last| last.set(Some((self.ivars().display, area))));
            self.finish(Some(area));
        }
    }

    /// Closes the panel and ends the capture with the area picked, if any.
    fn finish(&self, area: Option<Area>) {
        let state = self.ivars();
        let Some(done) = state.done.borrow_mut().take() else {
            return;
        };
        if let Some(window) = self.window() {
            window.orderOut(None);
        }
        // dropped after this event: the panel holds this view
        DispatchQueue::main().exec_async(|| {
            PANEL.with(|slot| slot.borrow_mut().take());
        });
        CAPTURING.store(false, Ordering::SeqCst);
        let crop = area.and_then(|area| {
            let picked = area.pixels(state.scale, self.frame_pixels())?;
            CGImage::with_image_in_rect(
                Some(&state.image),
                CGRect::new(
                    CGPoint::new(picked.x.into(), picked.y.into()),
                    CGSize::new(picked.width.into(), picked.height.into()),
                ),
            )
        });
        match crop {
            None => done(Outcome::Cancelled),
            // off the main thread: a whole display's PNG takes a while
            Some(crop) => {
                std::thread::spawn(move || {
                    done(match prepared(&crop) {
                        Ok(image) => Outcome::Captured(image),
                        Err(error) => Outcome::Failed(error),
                    })
                });
            }
        }
    }
}

/// A rounded box holding a line of white text: the size label and the button.
fn pill(
    scale: CGFloat,
    background: &CGColor,
    type_size: CGFloat,
    weight: NSFontWeight,
) -> (Retained<CALayer>, Retained<CATextLayer>) {
    let pill = CALayer::new();
    pill.setBackgroundColor(Some(background));
    pill.setCornerRadius(LABEL_RADIUS);
    pill.setHidden(true);
    let text = CATextLayer::new();
    let font = NSFont::monospacedDigitSystemFontOfSize_weight(type_size, weight);
    // SAFETY: NSFont is toll-free bridged with CTFont, a font a text layer takes.
    unsafe { text.setFont(Some(&*(Retained::as_ptr(&font).cast::<CFType>()))) };
    text.setFontSize(type_size);
    text.setForegroundColor(Some(&CGColor::new_generic_gray(1.0, 1.0)));
    text.setContentsScale(scale);
    pill.addSublayer(&text);
    (pill, text)
}

/// The pointer for drawing an area, or resizing it from a handle: macOS 15's frame cursors,
/// before them the crosshair (the older resize arrows are deprecated).
fn grip_cursor(grip: Grip) -> Retained<NSCursor> {
    let Grip::Resize(handle) = grip else {
        return NSCursor::crosshairCursor();
    };
    if available!(macos = 15.0) {
        let position = match handle {
            Handle::TopLeft => NSCursorFrameResizePosition::TopLeft,
            Handle::Top => NSCursorFrameResizePosition::Top,
            Handle::TopRight => NSCursorFrameResizePosition::TopRight,
            Handle::Right => NSCursorFrameResizePosition::Right,
            Handle::BottomRight => NSCursorFrameResizePosition::BottomRight,
            Handle::Bottom => NSCursorFrameResizePosition::Bottom,
            Handle::BottomLeft => NSCursorFrameResizePosition::BottomLeft,
            Handle::Left => NSCursorFrameResizePosition::Left,
        };
        return NSCursor::frameResizeCursorFromPosition_inDirections(
            position,
            NSCursorFrameResizeDirections::All,
        );
    }
    NSCursor::crosshairCursor()
}

fn rect(area: Area) -> CGRect {
    CGRect::new(
        CGPoint::new(area.x, area.y),
        CGSize::new(area.width, area.height),
    )
}

/// The crop as a note's image, its colors in sRGB (a display's own space, P3 on a MacBook, would
/// shift them where the image is shown untagged).
fn prepared(crop: &CGImage) -> anyhow::Result<PreparedImage> {
    let width = CGImage::width(Some(crop));
    let height = CGImage::height(Some(crop));
    let mut rgba = vec![0u8; width * height * 4];
    // SAFETY: the system's constant.
    let space = CGColorSpace::with_name(Some(unsafe { kCGColorSpaceSRGB }))
        .ok_or_else(|| anyhow!("no sRGB color space"))?;
    // SAFETY: `rgba` holds `height` rows of `width * 4` bytes and outlives the context.
    let context = unsafe {
        CGBitmapContextCreate(
            rgba.as_mut_ptr().cast::<c_void>(),
            width,
            height,
            8,
            width * 4,
            Some(&space),
            CGImageAlphaInfo::PremultipliedLast.0 | CGImageByteOrderInfo::Order32Big.0,
        )
    }
    .ok_or_else(|| anyhow!("no {width}x{height} bitmap"))?;
    CGContext::draw_image(
        Some(&context),
        CGRect::new(
            CGPoint::ZERO,
            CGSize::new(width as CGFloat, height as CGFloat),
        ),
        Some(crop),
    );
    drop(context);
    prepare_capture(width as u32, height as u32, rgba)
}
