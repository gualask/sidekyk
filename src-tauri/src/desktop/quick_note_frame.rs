//! The window's frame for the quick note: its size and place under the pointer, and the frame it
//! had before, back.

use tauri::{
    AppHandle, LogicalSize, PhysicalPosition, PhysicalRect, PhysicalSize, Size, WebviewWindow,
};

use crate::infrastructure::window as system;

/// The quick note's size, in the window's points; the page's box has it too (`QuickNote.tsx`),
/// for a window that cannot shrink.
const WIDTH: f64 = 560.0;
const HEIGHT: f64 = 168.0;

/// The window's frame, least size and buttons for the quick note, under the pointer.
pub(super) fn quick_note_frame(app: &AppHandle, window: &WebviewWindow) {
    let _ = window.set_min_size(None::<Size>);
    let _ = window.set_size(LogicalSize::new(WIDTH, HEIGHT));
    if let Some(position) = under_pointer(app) {
        let _ = window.set_position(position);
    }
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

/// Where the quick note goes: centered on the display under the pointer, a quarter down.
fn under_pointer(app: &AppHandle) -> Option<PhysicalPosition<i32>> {
    let pointer = app.cursor_position().ok()?;
    let monitor = app.monitor_from_point(pointer.x, pointer.y).ok()??;
    Some(place(monitor.work_area(), monitor.scale_factor()))
}

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
}
