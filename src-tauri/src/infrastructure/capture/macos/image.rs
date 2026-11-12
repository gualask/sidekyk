//! macOS capture's area taken: cut out of the frozen frame at its pixels, then made a note's image
//! off the main thread.

use std::ffi::c_void;

use anyhow::anyhow;
use objc2_core_foundation::{CFRetained, CGFloat, CGPoint, CGRect, CGSize};
use objc2_core_graphics::{
    kCGColorSpaceSRGB, CGBitmapContextCreate, CGColorSpace, CGContext, CGImage, CGImageAlphaInfo,
    CGImageByteOrderInfo,
};
use sidekyk_core::modules::capture::{Area, Outcome, Taken};
use sidekyk_core::modules::notes::{prepare_capture, PreparedImage};

use super::super::Done;

/// The frozen frame's size, in pixels.
pub(super) fn pixel_size(frame: &CGImage) -> (u32, u32) {
    (
        CGImage::width(Some(frame)) as u32,
        CGImage::height(Some(frame)) as u32,
    )
}

/// The frame's pixels under `area`, in points at the display's `scale`; none when it holds none.
pub(super) fn cropped(frame: &CGImage, scale: CGFloat, area: Area) -> Option<CFRetained<CGImage>> {
    let picked = area.pixels(scale, pixel_size(frame))?;
    CGImage::with_image_in_rect(
        Some(frame),
        CGRect::new(
            CGPoint::new(picked.x.into(), picked.y.into()),
            CGSize::new(picked.width.into(), picked.height.into()),
        ),
    )
}

/// Ends the capture with the crop as a note's image, off the main thread: a whole display's PNG
/// takes a while.
pub(super) fn deliver(crop: CFRetained<CGImage>, taken: Taken, done: Done) {
    std::thread::spawn(move || {
        done(match prepared(&crop) {
            Ok(image) => Outcome::Captured { image, taken },
            Err(error) => Outcome::Failed(error),
        })
    });
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
