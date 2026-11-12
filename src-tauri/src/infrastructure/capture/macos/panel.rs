//! macOS capture's panel: borderless, non-activating, above everything, holding the view that
//! shows the frame; one at a time, on the main thread, kept until the capture ends.

use std::cell::RefCell;

use objc2::rc::Retained;
use objc2::{define_class, msg_send, MainThreadMarker, MainThreadOnly};
use objc2_app_kit::{
    NSBackingStoreType, NSCursor, NSPanel, NSResponder, NSScreenSaverWindowLevel, NSWindow,
    NSWindowCollectionBehavior, NSWindowStyleMask,
};
use objc2_core_foundation::CFRetained;
use objc2_core_graphics::CGImage;
use sidekyk_core::modules::capture::Area;

use super::super::Done;
use super::view::OverlayView;
use super::Display;

thread_local! {
    /// The panel on screen, kept until the capture ends.
    static PANEL: RefCell<Option<Retained<OverlayPanel>>> = const { RefCell::new(None) };
}

/// Puts the panel up over the display, holding the frame. On the main thread.
pub(super) fn show(
    image: CFRetained<CGImage>,
    display: Display,
    confirm: &'static str,
    last: Option<Area>,
    done: Done,
) {
    let mtm = MainThreadMarker::new().expect("the main queue runs on the main thread");
    let panel = OverlayPanel::new(mtm, image, display, confirm, last, done);
    panel.orderFrontRegardless();
    panel.makeKeyWindow();
    NSCursor::crosshairCursor().set();
    PANEL.with(|slot| *slot.borrow_mut() = Some(panel));
}

/// Drops the panel on screen, if any. Never while one of its view's events runs: the panel holds
/// that view.
pub(super) fn release() {
    PANEL.with(|slot| slot.borrow_mut().take());
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
        last: Option<Area>,
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
        let view = OverlayView::new(mtm, image, display, confirm, last, done);
        panel.setContentView(Some(&view));
        panel.makeFirstResponder(Some(&view));
        panel
    }
}
