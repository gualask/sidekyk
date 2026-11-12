//! macOS capture's layers: the frozen frame dimmed and, over it, the same frame bright in the area
//! with its border and handles, the size label and the button that takes it, placed as the area
//! changes. CoreAnimation draws them; nothing is repainted.

use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2_app_kit::{NSFont, NSFontWeight, NSFontWeightMedium, NSFontWeightSemibold};
use objc2_core_foundation::{CFType, CGFloat, CGPoint, CGRect, CGSize};
use objc2_core_graphics::{CGColor, CGImage};
use objc2_foundation::NSString;
use objc2_quartz_core::{CALayer, CATextLayer};
use sidekyk_core::modules::capture::{Area, Handle, Size};

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

/// The layers over the dimmed frame, kept to place them as the area changes.
pub(super) struct Layers {
    /// The frame again, bright, shown over the dimmed one in the area.
    bright: Retained<CALayer>,
    handles: Vec<(Handle, Retained<CALayer>)>,
    label: Retained<CALayer>,
    text: Retained<CATextLayer>,
    button: Retained<CALayer>,
}

impl Layers {
    /// The root layer, `image` dimmed over `bounds` (points from the top left), and the layers
    /// over it, hidden; `confirm` the button's text, `scale` the display's.
    pub(super) fn new(
        image: &CGImage,
        bounds: CGRect,
        scale: CGFloat,
        confirm: &str,
    ) -> (Retained<CALayer>, Self) {
        let contents: &AnyObject = AsRef::<CFType>::as_ref(image).as_ref();
        let root = CALayer::new();
        root.setGeometryFlipped(true);
        // SAFETY: an image is what a layer's contents take.
        unsafe { root.setContents(Some(contents)) };
        root.addSublayer(&dim(bounds));
        let bright = bright(contents);
        root.addSublayer(&bright);
        let handles = Handle::ALL
            .into_iter()
            .map(|handle| {
                let layer = handle_layer();
                root.addSublayer(&layer);
                (handle, layer)
            })
            .collect();
        // SAFETY: the system's constants.
        let (medium, semibold) = unsafe { (NSFontWeightMedium, NSFontWeightSemibold) };
        let (label, text) = pill(
            scale,
            &CGColor::new_generic_gray(0.0, LABEL_SHADE),
            LABEL_TYPE,
            medium,
        );
        root.addSublayer(&label);
        let button = button(scale, semibold, confirm);
        root.addSublayer(&button);
        let layers = Self {
            bright,
            handles,
            label,
            text,
            button,
        };
        (root, layers)
    }

    /// Shows the area's layers while there is one, the button while it is picked.
    pub(super) fn show(&self, area: bool, picked: bool) {
        self.bright.setHidden(!area);
        self.label.setHidden(!area);
        for (_, handle) in &self.handles {
            handle.setHidden(!area);
        }
        self.button.setHidden(!picked);
    }

    /// Places the layers on `area`, of a display of `size`, `label` its size; the button's frame
    /// when it is `picked`.
    pub(super) fn place(
        &self,
        area: Area,
        size: Size,
        label: &str,
        picked: bool,
    ) -> Option<CGRect> {
        self.place_area(area, size);
        self.place_bar(area, size, label, picked)
    }

    /// The bright frame cut to the area, and the handles on its edges.
    fn place_area(&self, area: Area, size: Size) {
        self.bright.setFrame(rect(area));
        self.bright.setContentsRect(CGRect::new(
            CGPoint::new(area.x / size.width, area.y / size.height),
            CGSize::new(area.width / size.width, area.height / size.height),
        ));
        for (handle, layer) in &self.handles {
            let at = area.handle_point(*handle);
            layer.setPosition(CGPoint::new(at.x, at.y));
        }
    }

    /// The label, then the button when `picked`, centered on one line beside the area; the
    /// button's frame.
    fn place_bar(&self, area: Area, size: Size, label: &str, picked: bool) -> Option<CGRect> {
        let label = NSString::from_str(label);
        // SAFETY: a string is what a text layer shows.
        unsafe { self.text.setString(Some(&label)) };
        let text = self.text.preferredFrameSize();
        let label_size = CGSize::new(
            text.width + 2.0 * LABEL_PAD.0,
            text.height + 2.0 * LABEL_PAD.1,
        );
        let button = self.button.bounds().size;
        let bar = bar_size(label_size, picked.then_some(button));
        let origin = area.label_origin(bar, size);
        let middle = |height: CGFloat| origin.y + (bar.height - height) / 2.0;
        self.label.setFrame(CGRect::new(
            CGPoint::new(origin.x, middle(label_size.height)),
            label_size,
        ));
        self.text
            .setFrame(CGRect::new(CGPoint::new(LABEL_PAD.0, LABEL_PAD.1), text));
        if !picked {
            return None;
        }
        let frame = CGRect::new(
            CGPoint::new(origin.x + label_size.width + BAR_GAP, middle(button.height)),
            button,
        );
        self.button.setFrame(frame);
        Some(frame)
    }
}

/// The shade over the whole frame.
fn dim(bounds: CGRect) -> Retained<CALayer> {
    let dim = CALayer::new();
    dim.setFrame(bounds);
    dim.setBackgroundColor(Some(&CGColor::new_generic_gray(0.0, DIM)));
    dim
}

/// The frame again, `contents`, bordered, hidden until there is an area.
fn bright(contents: &AnyObject) -> Retained<CALayer> {
    let bright = CALayer::new();
    // SAFETY: an image is what a layer's contents take.
    unsafe { bright.setContents(Some(contents)) };
    bright.setBorderWidth(BORDER.0);
    bright.setBorderColor(Some(&CGColor::new_generic_gray(1.0, BORDER.1)));
    bright.setHidden(true);
    bright
}

/// A handle: a white dot, outlined, hidden.
fn handle_layer() -> Retained<CALayer> {
    let layer = CALayer::new();
    layer.setBounds(CGRect::new(CGPoint::ZERO, CGSize::new(HANDLE, HANDLE)));
    layer.setCornerRadius(HANDLE / 2.0);
    layer.setBackgroundColor(Some(&CGColor::new_generic_gray(1.0, 1.0)));
    layer.setBorderWidth(HANDLE_OUTLINE.0);
    layer.setBorderColor(Some(&CGColor::new_generic_gray(0.0, HANDLE_OUTLINE.1)));
    layer.setHidden(true);
    layer
}

/// The primary action: the app's accent, white, larger, `↵` named on it after `confirm`.
fn button(scale: CGFloat, weight: NSFontWeight, confirm: &str) -> Retained<CALayer> {
    let (button, text) = pill(
        scale,
        &CGColor::new_srgb(ACCENT.0, ACCENT.1, ACCENT.2, 1.0),
        BUTTON_TYPE,
        weight,
    );
    button.setCornerRadius(BUTTON_RADIUS);
    button.setShadowColor(Some(&CGColor::new_generic_gray(0.0, 1.0)));
    button.setShadowOpacity(BUTTON_SHADOW.0);
    button.setShadowRadius(BUTTON_SHADOW.1);
    button.setShadowOffset(CGSize::new(0.0, BUTTON_SHADOW.2));
    let confirm = NSString::from_str(&format!("{confirm}  ↵"));
    // SAFETY: a string is what a text layer shows.
    unsafe { text.setString(Some(&confirm)) };
    let fit = text.preferredFrameSize();
    text.setFrame(CGRect::new(CGPoint::new(BUTTON_PAD.0, BUTTON_PAD.1), fit));
    button.setBounds(CGRect::new(
        CGPoint::ZERO,
        CGSize::new(
            fit.width + 2.0 * BUTTON_PAD.0,
            fit.height + 2.0 * BUTTON_PAD.1,
        ),
    ));
    button
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

/// The label and the button beside it, when shown, on one line.
fn bar_size(label: CGSize, button: Option<CGSize>) -> Size {
    match button {
        Some(button) => Size {
            width: label.width + BAR_GAP + button.width,
            height: label.height.max(button.height),
        },
        None => Size {
            width: label.width,
            height: label.height,
        },
    }
}

fn rect(area: Area) -> CGRect {
    CGRect::new(
        CGPoint::new(area.x, area.y),
        CGSize::new(area.width, area.height),
    )
}
