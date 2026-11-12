//! macOS capture's view: the frozen frame, dimmed, and the area picked over it. It forwards the
//! pointer and the keys to the core's `Selection`, places the layers as it changes, and ends the
//! capture.

use std::cell::{Cell, RefCell};

use dispatch2::DispatchQueue;
use objc2::rc::Retained;
use objc2::{
    available, define_class, msg_send, AllocAnyThread, DefinedClass, MainThreadMarker,
    MainThreadOnly,
};
use objc2_app_kit::{
    NSCursor, NSCursorFrameResizeDirections, NSCursorFrameResizePosition, NSEvent, NSResponder,
    NSTrackingArea, NSTrackingAreaOptions, NSView,
};
use objc2_core_foundation::{CFRetained, CGFloat, CGPoint, CGRect, CGSize};
use objc2_core_graphics::CGImage;
use objc2_quartz_core::CATransaction;
use sidekyk_core::modules::capture::{Area, Grip, Handle, Outcome, Point, Selection, Size, Taken};

use super::super::Done;
use super::image::{cropped, deliver, pixel_size};
use super::layers::Layers;
use super::panel::release;
use super::Display;

/// Key codes: `Esc`, `↵` and the keypad's Enter.
const ESCAPE: u16 = 53;
const RETURN: u16 = 36;
const ENTER: u16 = 76;

pub(super) struct ViewState {
    image: CFRetained<CGImage>,
    display: u32,
    scale: CGFloat,
    /// The display's size, in points.
    size: Size,
    selection: RefCell<Selection>,
    layers: Layers,
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
    pub(super) struct OverlayView;

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
    pub(super) fn new(
        mtm: MainThreadMarker,
        image: CFRetained<CGImage>,
        display: Display,
        confirm: &'static str,
        last: Option<Area>,
        done: Done,
    ) -> Retained<Self> {
        let size = Size {
            width: display.frame.size.width,
            height: display.frame.size.height,
        };
        let bounds = CGRect::new(CGPoint::ZERO, CGSize::new(size.width, size.height));
        let (root, layers) = Layers::new(&image, bounds, display.scale, confirm);
        let state = ViewState {
            image,
            display: display.id,
            scale: display.scale,
            size,
            selection: RefCell::new(Selection::new(size, last)),
            layers,
            button_frame: Cell::new(None),
            done: RefCell::new(Some(done)),
        };
        let this = Self::alloc(mtm).set_ivars(state);
        // SAFETY: NSView's designated initializer.
        let view: Retained<Self> = unsafe { msg_send![super(this), initWithFrame: bounds] };
        // a layer-hosting view: the layers are ours to arrange
        view.setLayer(Some(&root));
        view.setWantsLayer(true);
        view.track_pointer(bounds);
        view.draw();
        view
    }

    /// Follows the pointer over `bounds`, so its shape follows what a press would do.
    fn track_pointer(&self, bounds: CGRect) {
        // SAFETY: the view owns the area, and outlives it.
        let tracking = unsafe {
            NSTrackingArea::initWithRect_options_owner_userInfo(
                NSTrackingArea::alloc(),
                bounds,
                NSTrackingAreaOptions::MouseMoved
                    | NSTrackingAreaOptions::ActiveAlways
                    | NSTrackingAreaOptions::InVisibleRect,
                Some(self),
                None,
            )
        };
        self.addTrackingArea(&tracking);
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
        let picked = selection.picked().is_some();
        state.layers.show(area.is_some(), picked);
        state.button_frame.set(None);
        if let Some(area) = area {
            let label = area.label(state.scale, pixel_size(&state.image));
            let button = state.layers.place(area, state.size, &label, picked);
            state.button_frame.set(button);
        }
        CATransaction::commit();
    }

    /// Takes the area picked, if one is.
    fn confirm(&self) {
        let picked = self.ivars().selection.borrow().picked();
        if let Some(area) = picked {
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
        DispatchQueue::main().exec_async(release);
        let crop = area.and_then(|area| Some((cropped(&state.image, state.scale, area)?, area)));
        match crop {
            None => done(Outcome::Cancelled),
            Some((crop, area)) => {
                let taken = Taken {
                    display: state.display,
                    area,
                };
                deliver(crop, taken, done);
            }
        }
    }
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
