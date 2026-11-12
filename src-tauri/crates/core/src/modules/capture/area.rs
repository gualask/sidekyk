//! The area picked over the frozen display, in the overlay's points (origin top left): drawn by a
//! drag, moved, or resized from an edge or a corner (`Handle`); where its handles and its size's
//! label go, and the pixels of the frame it crops.

/// Narrower or lower than this, in points, an area is a click: it captures nothing.
const MIN_SIDE: f64 = 4.0;
/// The gap between the area and its size's label, in points.
const LABEL_GAP: f64 = 8.0;
/// How near an edge or a corner, in points, a press takes it to resize.
const REACH: f64 = 6.0;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Size {
    pub width: f64,
    pub height: f64,
}

/// A rectangle in points, its sides never negative.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Area {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// A rectangle of the frame's pixels.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PixelRect {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

impl Area {
    /// The area between where the drag started and where the pointer is, whichever way it went,
    /// kept on the display.
    pub(super) fn dragged(from: Point, to: Point, display: Size) -> Self {
        let clamp_x = |x: f64| x.clamp(0.0, display.width);
        let clamp_y = |y: f64| y.clamp(0.0, display.height);
        let (left, right) = ordered(clamp_x(from.x), clamp_x(to.x));
        let (top, bottom) = ordered(clamp_y(from.y), clamp_y(to.y));
        Self {
            x: left,
            y: top,
            width: right - left,
            height: bottom - top,
        }
    }

    /// Whether the area is wide and high enough to capture; less is a click, which cancels.
    pub(super) fn is_capture(&self) -> bool {
        self.width >= MIN_SIDE && self.height >= MIN_SIDE
    }

    /// The pixels it covers in a frame of `pixels` read at `scale` pixels a point: every pixel
    /// it touches, none outside the frame. None when it covers none.
    pub fn pixels(&self, scale: f64, pixels: (u32, u32)) -> Option<PixelRect> {
        let to_pixel = |value: f64, limit: u32| (value * scale).clamp(0.0, f64::from(limit));
        let left = to_pixel(self.x, pixels.0).floor() as u32;
        let top = to_pixel(self.y, pixels.1).floor() as u32;
        let right = to_pixel(self.x + self.width, pixels.0).ceil() as u32;
        let bottom = to_pixel(self.y + self.height, pixels.1).ceil() as u32;
        (right > left && bottom > top).then(|| PixelRect {
            x: left,
            y: top,
            width: right - left,
            height: bottom - top,
        })
    }

    /// Its size as the label shows it: the pixels it crops of the frame (`pixels`), "1240 × 680".
    pub fn label(&self, scale: f64, pixels: (u32, u32)) -> String {
        let (width, height) = self
            .pixels(scale, pixels)
            .map_or((0, 0), |rect| (rect.width, rect.height));
        format!("{width} × {height}")
    }

    /// Where a label of `label` size goes: below the area's right edge, above it when the display
    /// ends first, inside the display either way.
    pub fn label_origin(&self, label: Size, display: Size) -> Point {
        let x =
            (self.x + self.width - label.width).clamp(0.0, (display.width - label.width).max(0.0));
        let below = self.y + self.height + LABEL_GAP;
        let y = if below + label.height <= display.height {
            below
        } else {
            (self.y - LABEL_GAP - label.height).max(0.0)
        };
        Point { x, y }
    }
}

impl Area {
    fn right(&self) -> f64 {
        self.x + self.width
    }

    fn bottom(&self) -> f64 {
        self.y + self.height
    }

    /// Whether it lies whole on a display of this size and can be captured: a remembered area
    /// on a display since resized may not.
    pub(super) fn fits(&self, display: Size) -> bool {
        self.is_capture()
            && self.x >= 0.0
            && self.y >= 0.0
            && self.right() <= display.width
            && self.bottom() <= display.height
    }

    /// Where a handle is drawn: a corner, or the middle of an edge.
    pub fn handle_point(&self, handle: Handle) -> Point {
        let (h, v) = handle.sides();
        let along = |side: i8, start: f64, length: f64| match side {
            -1 => start,
            1 => start + length,
            _ => start + length / 2.0,
        };
        Point {
            x: along(h, self.x, self.width),
            y: along(v, self.y, self.height),
        }
    }

    /// The handle a press here takes: a corner first, then an edge, anywhere along it. An edge
    /// reaches `REACH` out, and in at most a quarter of the side, so a small area keeps a middle
    /// that moves it.
    pub(super) fn handle_at(&self, at: Point) -> Option<Handle> {
        let within =
            |value: f64, start: f64, end: f64| value >= start - REACH && value <= end + REACH;
        if !within(at.x, self.x, self.right()) || !within(at.y, self.y, self.bottom()) {
            return None;
        }
        let side = |value: f64, start: f64, end: f64| {
            let inward = ((end - start) / 4.0).min(REACH);
            if value <= start + inward {
                -1
            } else if value >= end - inward {
                1
            } else {
                0
            }
        };
        Handle::from_sides(
            side(at.x, self.x, self.right()),
            side(at.y, self.y, self.bottom()),
        )
    }

    pub(super) fn contains(&self, at: Point) -> bool {
        at.x >= self.x && at.x <= self.right() && at.y >= self.y && at.y <= self.bottom()
    }

    /// Moved by `by`, whole on the display.
    pub(super) fn moved(&self, by: Point, display: Size) -> Self {
        Self {
            x: (self.x + by.x).clamp(0.0, (display.width - self.width).max(0.0)),
            y: (self.y + by.y).clamp(0.0, (display.height - self.height).max(0.0)),
            ..*self
        }
    }

    /// The handle's edges moved by `by`, the others still; past the opposite edge it turns over.
    pub(super) fn resized(&self, handle: Handle, by: Point, display: Size) -> Self {
        let (h, v) = handle.sides();
        let edges = |side: i8, start: f64, end: f64, by: f64| match side {
            -1 => (start + by, end),
            1 => (start, end + by),
            _ => (start, end),
        };
        let (left, right) = edges(h, self.x, self.right(), by.x);
        let (top, bottom) = edges(v, self.y, self.bottom(), by.y);
        Self::dragged(
            Point { x: left, y: top },
            Point {
                x: right,
                y: bottom,
            },
            display,
        )
    }
}

/// An edge or a corner of the area, which resizes it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Handle {
    TopLeft,
    Top,
    TopRight,
    Right,
    BottomRight,
    Bottom,
    BottomLeft,
    Left,
}

impl Handle {
    pub const ALL: [Handle; 8] = [
        Handle::TopLeft,
        Handle::Top,
        Handle::TopRight,
        Handle::Right,
        Handle::BottomRight,
        Handle::Bottom,
        Handle::BottomLeft,
        Handle::Left,
    ];

    /// The sides it moves, across and down: -1 the left or top, 1 the right or bottom, 0 none.
    fn sides(self) -> (i8, i8) {
        match self {
            Handle::TopLeft => (-1, -1),
            Handle::Top => (0, -1),
            Handle::TopRight => (1, -1),
            Handle::Right => (1, 0),
            Handle::BottomRight => (1, 1),
            Handle::Bottom => (0, 1),
            Handle::BottomLeft => (-1, 1),
            Handle::Left => (-1, 0),
        }
    }

    fn from_sides(h: i8, v: i8) -> Option<Self> {
        Self::ALL
            .into_iter()
            .find(|handle| handle.sides() == (h, v))
    }
}

fn ordered(a: f64, b: f64) -> (f64, f64) {
    if a <= b {
        (a, b)
    } else {
        (b, a)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const DISPLAY: Size = Size {
        width: 1470.0,
        height: 956.0,
    };

    fn point(x: f64, y: f64) -> Point {
        Point { x, y }
    }

    fn area(x: f64, y: f64, width: f64, height: f64) -> Area {
        Area {
            x,
            y,
            width,
            height,
        }
    }

    #[test]
    fn a_drag_gives_the_same_area_whichever_way_it_went() {
        let down_right = Area::dragged(point(100.0, 50.0), point(300.0, 250.0), DISPLAY);
        let up_left = Area::dragged(point(300.0, 250.0), point(100.0, 50.0), DISPLAY);
        assert_eq!(down_right, up_left);
        assert_eq!(
            down_right,
            Area {
                x: 100.0,
                y: 50.0,
                width: 200.0,
                height: 200.0
            }
        );
    }

    #[test]
    fn a_drag_past_the_display_stops_at_its_edge() {
        let area = Area::dragged(point(1400.0, 900.0), point(2000.0, -40.0), DISPLAY);
        assert_eq!(
            area,
            Area {
                x: 1400.0,
                y: 0.0,
                width: 70.0,
                height: 900.0
            }
        );
    }

    #[test]
    fn a_click_or_a_line_captures_nothing() {
        assert!(!Area::dragged(point(10.0, 10.0), point(11.0, 12.0), DISPLAY).is_capture());
        assert!(!Area::dragged(point(10.0, 10.0), point(400.0, 12.0), DISPLAY).is_capture());
        assert!(Area::dragged(point(10.0, 10.0), point(14.0, 14.0), DISPLAY).is_capture());
    }

    #[test]
    fn the_pixels_cover_every_one_the_area_touches() {
        let area = Area {
            x: 10.25,
            y: 20.5,
            width: 100.5,
            height: 50.0,
        };
        assert_eq!(
            area.pixels(2.0, (2940, 1912)),
            Some(PixelRect {
                x: 20,
                y: 41,
                width: 202,
                height: 100
            })
        );
    }

    #[test]
    fn the_pixels_stay_inside_the_frame() {
        let whole = Area {
            x: 0.0,
            y: 0.0,
            width: DISPLAY.width,
            height: DISPLAY.height,
        };
        // a frame one pixel short of the display's points at 2x: a scaled display's rounding
        assert_eq!(
            whole.pixels(2.0, (2939, 1911)),
            Some(PixelRect {
                x: 0,
                y: 0,
                width: 2939,
                height: 1911
            })
        );
        let outside = Area {
            x: 1470.0,
            y: 0.0,
            width: 10.0,
            height: 10.0,
        };
        assert_eq!(outside.pixels(2.0, (2940, 1912)), None);
    }

    #[test]
    fn the_label_tells_the_pixels() {
        let area = Area {
            x: 0.0,
            y: 0.0,
            width: 620.0,
            height: 340.25,
        };
        // every pixel the crop has, a part one included
        assert_eq!(area.label(2.0, (2940, 1912)), "1240 × 681");
        assert_eq!(area.label(1.0, (1470, 956)), "620 × 341");
    }

    #[test]
    fn the_label_goes_below_or_above_and_stays_on_the_display() {
        let label = Size {
            width: 90.0,
            height: 22.0,
        };
        let middle = Area {
            x: 100.0,
            y: 100.0,
            width: 200.0,
            height: 100.0,
        };
        assert_eq!(middle.label_origin(label, DISPLAY), point(210.0, 208.0));
        let at_bottom = Area {
            x: 100.0,
            y: 800.0,
            width: 200.0,
            height: 156.0,
        };
        assert_eq!(at_bottom.label_origin(label, DISPLAY), point(210.0, 770.0));
        let narrow_at_left = Area {
            x: 0.0,
            y: 100.0,
            width: 30.0,
            height: 30.0,
        };
        assert_eq!(narrow_at_left.label_origin(label, DISPLAY).x, 0.0);
    }

    #[test]
    fn handles_sit_on_the_corners_and_the_middles_of_the_edges() {
        let area = area(100.0, 100.0, 200.0, 100.0);
        assert_eq!(area.handle_point(Handle::TopLeft), point(100.0, 100.0));
        assert_eq!(area.handle_point(Handle::Right), point(300.0, 150.0));
        assert_eq!(area.handle_point(Handle::Bottom), point(200.0, 200.0));
    }
}
