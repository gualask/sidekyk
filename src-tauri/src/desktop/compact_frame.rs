//! The window's frame for each compact view: the quick note's size and place under the pointer,
//! the capture window's fitted to its image on the display it was taken on, and the frame it had
//! before, back.

use tauri::{
    AppHandle, LogicalSize, PhysicalPosition, PhysicalRect, PhysicalSize, Size, WebviewWindow,
};

use crate::infrastructure::window as system;

/// The quick note's size, in the window's points; the page's box has it too (`QuickNote.tsx`),
/// for a window that cannot shrink.
const WIDTH: f64 = 560.0;
const HEIGHT: f64 = 168.0;

/// The capture window's share of its display at most, each way.
const CAPTURE_SHARE: f64 = 0.7;
/// The capture window's least size, which keeps its fields usable, in points.
const CAPTURE_MIN: (f64, f64) = (560.0, 400.0);
/// The capture window's room around its image: the strip of images, the text, the destination
/// and the keys below, the margins around (`CaptureWindow.tsx`), in points.
const CAPTURE_AROUND: (f64, f64) = (32.0, 232.0);

/// The window's frame, least size and buttons for the quick note, under the pointer; its size, in
/// points.
pub(super) fn quick_note_frame(app: &AppHandle, window: &WebviewWindow) -> LogicalSize<f64> {
    let size = LogicalSize::new(WIDTH, HEIGHT);
    let monitor = system::monitor_under_pointer(app);
    compact(window, size);
    if let Some(monitor) = monitor {
        let _ = window.set_position(place(monitor.work_area(), monitor.scale_factor()));
    }
    size
}

/// The window's frame, least size and buttons for the capture window: fitted to an image of
/// `image` pixels, centered on `display` (the system's id), where it was taken, at its scale; its
/// size, in points.
pub(super) fn capture_frame(
    app: &AppHandle,
    window: &WebviewWindow,
    image: (u32, u32),
    display: u32,
) -> LogicalSize<f64> {
    let Some(monitor) = system::monitor_of(app, display) else {
        let size = LogicalSize::new(CAPTURE_MIN.0, CAPTURE_MIN.1);
        compact(window, size);
        return size;
    };
    let scale = monitor.scale_factor();
    let area = monitor.work_area();
    let room = LogicalSize::new(
        f64::from(area.size.width) / scale,
        f64::from(area.size.height) / scale,
    );
    let image = LogicalSize::new(f64::from(image.0) / scale, f64::from(image.1) / scale);
    let size = capture_size(room, image);
    compact(window, size);
    let _ = window.set_position(centered(area, scale, size));
    size
}

/// A compact view's frame of `size`, without a least size nor the window's buttons.
fn compact(window: &WebviewWindow, size: LogicalSize<f64>) {
    let _ = window.set_min_size(None::<Size>);
    let _ = window.set_size(size);
    system::set_buttons_hidden(window, true);
}

/// The window's frame, least size and buttons as before the quick note: `size` and `position`.
pub(super) fn restore_frame(
    app: &AppHandle,
    window: &WebviewWindow,
    size: PhysicalSize<u32>,
    position: PhysicalPosition<i32>,
) {
    let _ = window.set_size(size);
    let _ = window.set_position(position);
    let _ = window.set_min_size(min_size(app));
    system::set_buttons_hidden(window, false);
}

/// The window's least size, as configured (`tauri.conf.json`).
fn min_size(app: &AppHandle) -> Option<Size> {
    let config = app
        .config()
        .app
        .windows
        .iter()
        .find(|w| w.label == "main")?;
    let (width, height) = (config.min_width?, config.min_height?);
    Some(LogicalSize::new(width, height).into())
}

/// The capture window's size in a display's `room`, both in points: the image and the room around
/// it, within `CAPTURE_SHARE` of the display, at least `CAPTURE_MIN` (the display's, if smaller).
fn capture_size(room: LogicalSize<f64>, image: LogicalSize<f64>) -> LogicalSize<f64> {
    let side = |image: f64, around: f64, room: f64, least: f64| {
        let most = (room * CAPTURE_SHARE).round();
        (image + around).clamp(least.min(room), most.max(least.min(room)))
    };
    LogicalSize::new(
        side(image.width, CAPTURE_AROUND.0, room.width, CAPTURE_MIN.0),
        side(image.height, CAPTURE_AROUND.1, room.height, CAPTURE_MIN.1),
    )
}

/// Where a window of `size` points sits centered in `area`, at `scale`.
fn centered(
    area: &PhysicalRect<i32, u32>,
    scale: f64,
    size: LogicalSize<f64>,
) -> PhysicalPosition<i32> {
    let width = (size.width * scale).round() as i64;
    let height = (size.height * scale).round() as i64;
    let x = i64::from(area.position.x) + (i64::from(area.size.width) - width) / 2;
    let y = i64::from(area.position.y) + (i64::from(area.size.height) - height) / 2;
    PhysicalPosition::new(x as i32, y as i32)
}

/// Where the quick note goes: centered on its display, a quarter down.
fn place(area: &PhysicalRect<i32, u32>, scale: f64) -> PhysicalPosition<i32> {
    let width = (WIDTH * scale).round() as i64;
    let x = i64::from(area.position.x) + (i64::from(area.size.width) - width) / 2;
    let y = i64::from(area.position.y) + i64::from(area.size.height) / 4;
    PhysicalPosition::new(x as i32, y as i32)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_note_sits_centered_a_quarter_down_its_display() {
        let area = PhysicalRect {
            position: PhysicalPosition::new(-1920, 0),
            size: PhysicalSize::new(1920, 1080),
        };
        assert_eq!(place(&area, 1.0), PhysicalPosition::new(-1920 + 680, 270));
        let retina = PhysicalRect {
            position: PhysicalPosition::new(0, 50),
            size: PhysicalSize::new(2940, 1846),
        };
        assert_eq!(place(&retina, 2.0), PhysicalPosition::new(910, 50 + 461));
    }

    #[test]
    fn the_capture_window_fits_its_image_within_its_share_of_the_display() {
        let room = LogicalSize::new(1470.0, 923.0);
        let size = |w, h| capture_size(room, LogicalSize::new(w, h));
        // a small area: the least size
        assert_eq!(size(120.0, 80.0), LogicalSize::new(560.0, 400.0));
        // a middle one: the image and the room around it
        assert_eq!(size(700.0, 300.0), LogicalSize::new(732.0, 532.0));
        // the whole display: 70% of it
        assert_eq!(size(1470.0, 923.0), LogicalSize::new(1029.0, 646.0));
        // a display smaller than the least size: the display
        let tiny = capture_size(
            LogicalSize::new(500.0, 300.0),
            LogicalSize::new(400.0, 200.0),
        );
        assert_eq!(tiny, LogicalSize::new(500.0, 300.0));
    }

    #[test]
    fn the_capture_window_sits_centered_on_its_display() {
        let retina = PhysicalRect {
            position: PhysicalPosition::new(0, 50),
            size: PhysicalSize::new(2940, 1846),
        };
        assert_eq!(
            centered(&retina, 2.0, LogicalSize::new(732.0, 532.0)),
            PhysicalPosition::new((2940 - 1464) / 2, 50 + (1846 - 1064) / 2)
        );
    }
}
