//! The area picked over the frozen display (`area`), as the overlay's presses and drags change it
//! until it is captured. The same on every system: only the window drawing it is theirs.

use super::area::{Area, Handle, Point, Size};

/// What a press at a point does, and so the pointer's shape there.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Grip {
    /// Draws a new area, in place of the current one.
    Draw,
    /// Moves the area.
    Move,
    Resize(Handle),
}

/// The area picked so far and the drag changing it.
#[derive(Debug, Clone)]
pub struct Selection {
    display: Size,
    area: Option<Area>,
    drag: Option<Drag>,
}

#[derive(Debug, Clone, Copy)]
struct Drag {
    grip: Grip,
    from: Point,
    /// The area before the drag: back in place if it leaves none to capture.
    before: Option<Area>,
}

impl Selection {
    /// Starts with the area last captured on this display, if it still fits.
    pub fn new(display: Size, remembered: Option<Area>) -> Self {
        Self {
            display,
            area: remembered.filter(|area| area.fits(display)),
            drag: None,
        }
    }

    /// The area picked, while a drag changes it too.
    pub fn area(&self) -> Option<Area> {
        self.area
    }

    /// What a press here would do.
    pub fn grip(&self, at: Point) -> Grip {
        let Some(area) = self.area else {
            return Grip::Draw;
        };
        match area.handle_at(at) {
            Some(handle) => Grip::Resize(handle),
            None if area.contains(at) => Grip::Move,
            None => Grip::Draw,
        }
    }

    /// What the drag under way does, if one is.
    pub fn dragging(&self) -> Option<Grip> {
        self.drag.map(|drag| drag.grip)
    }

    pub fn press(&mut self, at: Point) {
        self.drag = Some(Drag {
            grip: self.grip(at),
            from: at,
            before: self.area,
        });
    }

    /// Changes the area as the drag goes; returns whether it changed.
    pub fn drag_to(&mut self, at: Point) -> bool {
        let Some(drag) = self.drag else {
            return false;
        };
        let by = Point {
            x: at.x - drag.from.x,
            y: at.y - drag.from.y,
        };
        let next = match (drag.grip, drag.before) {
            (Grip::Draw, _) => Area::dragged(drag.from, at, self.display),
            (Grip::Move, Some(area)) => area.moved(by, self.display),
            (Grip::Resize(handle), Some(area)) => area.resized(handle, by, self.display),
            (_, None) => return false,
        };
        let changed = self.area != Some(next);
        self.area = Some(next);
        changed
    }

    /// Ends the drag: an area too small to capture (a click) leaves the one before.
    pub fn release(&mut self) {
        if let Some(drag) = self.drag.take() {
            if !self.area.is_some_and(|area| area.is_capture()) {
                self.area = drag.before;
            }
        }
    }

    /// The area to capture, unless there is none or a drag is under way.
    pub fn picked(&self) -> Option<Area> {
        self.area
            .filter(|area| self.drag.is_none() && area.is_capture())
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
    fn a_drag_draws_an_area_that_stays_until_captured() {
        let mut selection = Selection::new(DISPLAY, None);
        assert_eq!(selection.grip(point(100.0, 100.0)), Grip::Draw);
        selection.press(point(100.0, 100.0));
        assert!(selection.drag_to(point(300.0, 200.0)));
        assert_eq!(selection.picked(), None, "not while dragging");
        selection.release();
        assert_eq!(selection.picked(), Some(area(100.0, 100.0, 200.0, 100.0)));
    }

    #[test]
    fn a_click_leaves_the_area_as_it_was() {
        let mut selection = Selection::new(DISPLAY, None);
        selection.press(point(100.0, 100.0));
        selection.drag_to(point(101.0, 102.0));
        selection.release();
        assert_eq!(selection.area(), None);

        let mut selection = Selection::new(DISPLAY, Some(area(100.0, 100.0, 200.0, 100.0)));
        selection.press(point(600.0, 600.0));
        selection.drag_to(point(602.0, 601.0));
        selection.release();
        assert_eq!(selection.picked(), Some(area(100.0, 100.0, 200.0, 100.0)));
    }

    #[test]
    fn a_drag_outside_draws_a_new_area_in_place_of_the_old() {
        let mut selection = Selection::new(DISPLAY, Some(area(100.0, 100.0, 200.0, 100.0)));
        selection.press(point(600.0, 600.0));
        selection.drag_to(point(500.0, 500.0));
        selection.release();
        assert_eq!(selection.picked(), Some(area(500.0, 500.0, 100.0, 100.0)));
    }

    #[test]
    fn a_drag_inside_moves_the_area_and_keeps_it_on_the_display() {
        let mut selection = Selection::new(DISPLAY, Some(area(100.0, 100.0, 200.0, 100.0)));
        assert_eq!(selection.grip(point(200.0, 150.0)), Grip::Move);
        selection.press(point(200.0, 150.0));
        selection.drag_to(point(250.0, 120.0));
        assert_eq!(selection.area(), Some(area(150.0, 70.0, 200.0, 100.0)));
        assert_eq!(selection.dragging(), Some(Grip::Move));
        selection.drag_to(point(5000.0, -5000.0));
        selection.release();
        assert_eq!(selection.picked(), Some(area(1270.0, 0.0, 200.0, 100.0)));
    }

    #[test]
    fn edges_and_corners_resize_corners_first() {
        let selection = Selection::new(DISPLAY, Some(area(100.0, 100.0, 200.0, 100.0)));
        assert_eq!(
            selection.grip(point(97.0, 103.0)),
            Grip::Resize(Handle::TopLeft)
        );
        assert_eq!(
            selection.grip(point(180.0, 98.0)),
            Grip::Resize(Handle::Top)
        );
        assert_eq!(
            selection.grip(point(304.0, 150.0)),
            Grip::Resize(Handle::Right)
        );
        assert_eq!(
            selection.grip(point(301.0, 205.0)),
            Grip::Resize(Handle::BottomRight)
        );
        assert_eq!(selection.grip(point(310.0, 150.0)), Grip::Draw);
    }

    #[test]
    fn a_small_area_keeps_a_middle_that_moves_it() {
        let selection = Selection::new(DISPLAY, Some(area(100.0, 100.0, 8.0, 8.0)));
        assert_eq!(selection.grip(point(104.0, 104.0)), Grip::Move);
        assert_eq!(
            selection.grip(point(101.0, 101.0)),
            Grip::Resize(Handle::TopLeft)
        );
        assert_eq!(
            selection.grip(point(112.0, 104.0)),
            Grip::Resize(Handle::Right)
        );
    }

    #[test]
    fn a_handle_moves_its_edges_and_turns_over_past_the_opposite_one() {
        let mut selection = Selection::new(DISPLAY, Some(area(100.0, 100.0, 200.0, 100.0)));
        selection.press(point(300.0, 150.0));
        selection.drag_to(point(350.0, 170.0));
        assert_eq!(selection.area(), Some(area(100.0, 100.0, 250.0, 100.0)));
        // past the left edge: the right one moves on from there
        selection.drag_to(point(50.0, 170.0));
        assert_eq!(selection.area(), Some(area(50.0, 100.0, 50.0, 100.0)));
        selection.release();

        let mut selection = Selection::new(DISPLAY, Some(area(100.0, 100.0, 200.0, 100.0)));
        selection.press(point(100.0, 100.0));
        selection.drag_to(point(-40.0, 80.0));
        selection.release();
        assert_eq!(selection.picked(), Some(area(0.0, 80.0, 300.0, 120.0)));
    }

    #[test]
    fn a_resize_down_to_a_line_leaves_the_area_as_it_was() {
        let mut selection = Selection::new(DISPLAY, Some(area(100.0, 100.0, 200.0, 100.0)));
        selection.press(point(300.0, 150.0));
        selection.drag_to(point(101.0, 150.0));
        selection.release();
        assert_eq!(selection.picked(), Some(area(100.0, 100.0, 200.0, 100.0)));
    }

    #[test]
    fn a_remembered_area_comes_back_only_if_it_still_fits() {
        let remembered = area(1300.0, 800.0, 160.0, 150.0);
        assert_eq!(
            Selection::new(DISPLAY, Some(remembered)).picked(),
            Some(remembered)
        );
        let smaller = Size {
            width: 1280.0,
            height: 800.0,
        };
        assert_eq!(Selection::new(smaller, Some(remembered)).picked(), None);
    }
}
