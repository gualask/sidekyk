//! A note's images: checked and measured on the way in, with a thumbnail for the cards, since a
//! card showing a 5K screenshot whole holds ~110 MB in the webview (`.local/note-thumbnails/`).
//! Pure: bytes in, bytes out; `NotesStore` writes them.

use std::io::Cursor;

use image::imageops::FilterType;
use image::{DynamicImage, ImageDecoder, ImageFormat, ImageReader, Limits};

use super::contracts::{ImageKind, Mark, NoteImage};
use crate::shared::error::{user_facing, UserFacingErrorCode};
use crate::shared::id::is_id;

/// The largest image file a note takes: a 5K screenshot is 1-15 MB.
pub const MAX_IMAGE_BYTES: u64 = 25 * 1024 * 1024;
/// The most pixels decoded: 8192 x 8192, 256 MiB as RGBA. A small file may declare many more.
const MAX_IMAGE_PIXELS: u64 = 8192 * 8192;
/// A thumbnail's longest side: a card shows it at most 240 px wide on a 2x screen.
const THUMB_SIDE: u32 = 480;
const THUMB_SUFFIX: &str = ".thumb.png";

/// An image ready to be kept: its bytes as given, and its thumbnail as PNG.
#[derive(Debug)]
pub struct PreparedImage {
    pub kind: ImageKind,
    /// As shown: an orientation the file states applied.
    pub width: u32,
    pub height: u32,
    pub original: Vec<u8>,
    pub thumb: Vec<u8>,
}

impl PreparedImage {
    /// The image a note keeps of it, under `id`.
    pub(super) fn note_image(&self, id: String) -> NoteImage {
        NoteImage {
            id,
            kind: self.kind,
            width: self.width,
            height: self.height,
            bytes: self.original.len() as u64,
            marked: None,
        }
    }
}

fn too_large() -> anyhow::Error {
    user_facing(UserFacingErrorCode::ImageTooLarge)
}

fn unsupported() -> anyhow::Error {
    user_facing(UserFacingErrorCode::ImageUnsupported)
}

/// The kind of an image's bytes, told by their content, never by a name.
fn kind_of(bytes: &[u8]) -> Option<(ImageKind, ImageFormat)> {
    let format = image::guess_format(bytes).ok()?;
    let kind = match format {
        ImageFormat::Png => ImageKind::Png,
        ImageFormat::Jpeg => ImageKind::Jpeg,
        ImageFormat::Gif => ImageKind::Gif,
        ImageFormat::WebP => ImageKind::Webp,
        _ => return None,
    };
    Some((kind, format))
}

/// Checks an image a note is given and makes its thumbnail: a format every webview shows, at most
/// `MAX_IMAGE_BYTES` and `MAX_IMAGE_PIXELS`. An animated image's thumbnail is its first frame.
pub fn prepare(original: Vec<u8>) -> anyhow::Result<PreparedImage> {
    if original.len() as u64 > MAX_IMAGE_BYTES {
        return Err(too_large());
    }
    let (kind, format) = kind_of(&original).ok_or_else(unsupported)?;
    let decoded = decode(&original, format)?;
    let thumb = thumbnail(&decoded)?;
    Ok(PreparedImage {
        kind,
        width: decoded.width(),
        height: decoded.height(),
        original,
        thumb,
    })
}

/// An image decoded within `MAX_IMAGE_PIXELS`, its size checked before its pixels are, turned
/// as its file says (a photo taken sideways).
fn decode(bytes: &[u8], format: ImageFormat) -> anyhow::Result<DynamicImage> {
    let mut reader = ImageReader::with_format(Cursor::new(bytes), format);
    let mut limits = Limits::default();
    limits.max_alloc = Some(MAX_IMAGE_PIXELS * 4);
    reader.limits(limits);
    let mut decoder = reader.into_decoder().map_err(decode_error)?;
    let (width, height) = decoder.dimensions();
    if u64::from(width) * u64::from(height) > MAX_IMAGE_PIXELS {
        return Err(too_large());
    }
    let orientation = decoder.orientation().map_err(decode_error)?;
    let mut decoded = DynamicImage::from_decoder(decoder).map_err(decode_error)?;
    decoded.apply_orientation(orientation);
    Ok(decoded)
}

/// A decoder's failure as the user is told it: over a limit, or not an image it reads.
fn decode_error(error: image::ImageError) -> anyhow::Error {
    match error {
        image::ImageError::Limits(_) => too_large(),
        error => unsupported().context(error.to_string()),
    }
}

/// The image at most `THUMB_SIDE` on its longest side, 8 bits a channel, as PNG: alpha kept, a
/// window's screenshot has a transparent shadow.
fn thumbnail(image: &DynamicImage) -> anyhow::Result<Vec<u8>> {
    let small = if image.width().max(image.height()) > THUMB_SIDE {
        image.resize(THUMB_SIDE, THUMB_SIDE, FilterType::Triangle)
    } else {
        image.clone()
    };
    let small = if small.color().has_alpha() {
        DynamicImage::ImageRgba8(small.into_rgba8())
    } else {
        DynamicImage::ImageRgb8(small.into_rgb8())
    };
    let mut png = Cursor::new(Vec::new());
    small.write_to(&mut png, ImageFormat::Png)?;
    Ok(png.into_inner())
}

/// An image's bytes as PNG, what a clipboard takes everywhere: as they are when they are PNG.
pub fn as_png(kind: ImageKind, bytes: Vec<u8>) -> anyhow::Result<Vec<u8>> {
    if kind == ImageKind::Png {
        return Ok(bytes);
    }
    let (_, format) = kind_of(&bytes).ok_or_else(unsupported)?;
    let mut png = Cursor::new(Vec::new());
    decode(&bytes, format)?.write_to(&mut png, ImageFormat::Png)?;
    Ok(png.into_inner())
}

/// The most marks an image takes, and the longest text of one (characters): a few letters or a
/// short sentence each, far below what fits.
const MAX_MARKS: usize = 100;
const MAX_MARK_CHARS: usize = 200;

/// Checks the marks of an image of `width` x `height`: within the limits, each point inside the
/// image, a text or a tail to each.
pub(super) fn check_marks(marks: &[Mark], width: u32, height: u32) -> anyhow::Result<()> {
    anyhow::ensure!(marks.len() <= MAX_MARKS, "more than {MAX_MARKS} marks");
    let inside = |x: u32, y: u32| x <= width && y <= height;
    for mark in marks {
        anyhow::ensure!(
            mark.text.chars().count() <= MAX_MARK_CHARS,
            "a mark's text over {MAX_MARK_CHARS} characters"
        );
        anyhow::ensure!(
            !mark.text.trim().is_empty() || mark.tail.is_some(),
            "a mark with neither text nor tail"
        );
        anyhow::ensure!(
            inside(mark.x, mark.y) && mark.tail.is_none_or(|tail| inside(tail.x, tail.y)),
            "a mark outside the image"
        );
    }
    Ok(())
}

/// The file of an image, beside its notes.
pub fn image_file(image: &NoteImage) -> String {
    file_named(&image.id, image.kind)
}

/// The file of the image `id`, of `kind`.
pub(super) fn file_named(id: &str, kind: ImageKind) -> String {
    format!("{id}.{}", kind.extension())
}

/// Every file of an image: its own and its thumbnail, then the image's under its marks.
pub(super) fn image_files(image: &NoteImage) -> Vec<String> {
    let mut files = vec![image_file(image), thumb_file(&image.id)];
    if image.marked.is_some() {
        let source = image.source();
        files.extend([image_file(&source), thumb_file(&source.id)]);
    }
    files
}

/// The file of an image's thumbnail.
pub fn thumb_file(id: &str) -> String {
    format!("{id}{THUMB_SUFFIX}")
}

/// The image a file of a book's folder belongs to, if it is an image's or a thumbnail's.
pub(super) fn image_of_file(file: &str) -> Option<&str> {
    let (id, rest) = file.split_once('.')?;
    let known = ImageKind::ALL.iter().any(|kind| rest == kind.extension())
        || format!(".{rest}") == THUMB_SUFFIX;
    (is_id(id) && known).then_some(id)
}

#[cfg(test)]
pub(super) mod tests {
    use super::*;
    use crate::shared::error::user_facing_code;

    /// An image of `width` x `height` encoded as `format`, its pixels a gradient.
    pub(crate) fn encoded(width: u32, height: u32, format: ImageFormat) -> Vec<u8> {
        let image = image::RgbImage::from_fn(width, height, |x, y| {
            image::Rgb([(x % 256) as u8, (y % 256) as u8, 128])
        });
        let mut out = Cursor::new(Vec::new());
        DynamicImage::ImageRgb8(image)
            .write_to(&mut out, format)
            .unwrap();
        out.into_inner()
    }

    fn code(result: anyhow::Result<PreparedImage>) -> Option<UserFacingErrorCode> {
        user_facing_code(&result.unwrap_err())
    }

    #[test]
    fn an_image_keeps_its_bytes_and_gets_a_thumbnail_on_its_longest_side() {
        let png = encoded(1200, 600, ImageFormat::Png);
        let prepared = prepare(png.clone()).unwrap();
        assert_eq!(prepared.kind, ImageKind::Png);
        assert_eq!((prepared.width, prepared.height), (1200, 600));
        assert_eq!(prepared.original, png);
        let thumb = image::load_from_memory(&prepared.thumb).unwrap();
        assert_eq!((thumb.width(), thumb.height()), (480, 240));
    }

    #[test]
    fn a_small_image_keeps_its_size_in_its_thumbnail() {
        let prepared = prepare(encoded(300, 20, ImageFormat::Jpeg)).unwrap();
        assert_eq!(prepared.kind, ImageKind::Jpeg);
        let thumb = image::load_from_memory(&prepared.thumb).unwrap();
        assert_eq!((thumb.width(), thumb.height()), (300, 20));
    }

    #[test]
    fn every_format_a_webview_shows_is_taken() {
        for (format, kind) in [
            (ImageFormat::Gif, ImageKind::Gif),
            (ImageFormat::WebP, ImageKind::Webp),
        ] {
            assert_eq!(prepare(encoded(8, 8, format)).unwrap().kind, kind);
        }
    }

    #[test]
    fn what_is_not_an_image_a_note_takes_is_refused() {
        let unsupported = Some(UserFacingErrorCode::ImageUnsupported);
        assert_eq!(code(prepare(b"# notes\n".to_vec())), unsupported);
        // a BMP's and a TIFF's first bytes: images, of formats a webview may not show
        assert_eq!(code(prepare(b"BM\0\0\0\0\0\0\0\0".to_vec())), unsupported);
        assert_eq!(code(prepare(b"II*\0\0\0\0\0".to_vec())), unsupported);
        // a PNG cut short
        let mut png = encoded(64, 64, ImageFormat::Png);
        png.truncate(png.len() / 2);
        assert_eq!(code(prepare(png)), unsupported);
    }

    #[test]
    fn an_image_over_the_limits_is_refused_before_it_is_decoded() {
        let too_large = Some(UserFacingErrorCode::ImageTooLarge);
        assert_eq!(
            code(prepare(vec![0; MAX_IMAGE_BYTES as usize + 1])),
            too_large
        );
        assert_eq!(code(prepare(declaring(9000, 9000))), too_large);
    }

    /// A small PNG whose header declares `width` x `height`: what a few bytes may claim.
    fn declaring(width: u32, height: u32) -> Vec<u8> {
        fn crc32(bytes: &[u8]) -> u32 {
            let mut crc = !0u32;
            for byte in bytes {
                crc ^= u32::from(*byte);
                for _ in 0..8 {
                    crc = if crc & 1 == 1 {
                        (crc >> 1) ^ 0xedb8_8320
                    } else {
                        crc >> 1
                    };
                }
            }
            !crc
        }
        let mut png = encoded(8, 8, ImageFormat::Png);
        // the signature (8), IHDR's length (4), then its type and data, then its CRC
        png[16..20].copy_from_slice(&width.to_be_bytes());
        png[20..24].copy_from_slice(&height.to_be_bytes());
        let crc = crc32(&png[12..29]);
        png[29..33].copy_from_slice(&crc.to_be_bytes());
        png
    }

    #[test]
    fn an_image_is_given_as_png() {
        let png = encoded(16, 8, ImageFormat::Png);
        assert_eq!(as_png(ImageKind::Png, png.clone()).unwrap(), png);
        let from_jpeg = as_png(ImageKind::Jpeg, encoded(16, 8, ImageFormat::Jpeg)).unwrap();
        assert_eq!(image::guess_format(&from_jpeg).unwrap(), ImageFormat::Png);
        let decoded = image::load_from_memory(&from_jpeg).unwrap();
        assert_eq!((decoded.width(), decoded.height()), (16, 8));
    }

    fn mark(x: u32, y: u32, text: &str, tail: Option<(u32, u32)>) -> Mark {
        Mark {
            x,
            y,
            text: text.into(),
            tail: tail.map(|(x, y)| crate::modules::notes::contracts::MarkPoint { x, y }),
        }
    }

    #[test]
    fn marks_stay_inside_their_image_and_say_something() {
        assert!(check_marks(&[], 10, 10).is_ok());
        assert!(check_marks(&[mark(10, 0, "A", Some((0, 10)))], 10, 10).is_ok());
        // a plain arrow
        assert!(check_marks(&[mark(5, 5, "", Some((1, 1)))], 10, 10).is_ok());
        assert!(check_marks(&[mark(5, 5, " ", None)], 10, 10).is_err());
        assert!(check_marks(&[mark(11, 5, "A", None)], 10, 10).is_err());
        assert!(check_marks(&[mark(5, 5, "A", Some((5, 11)))], 10, 10).is_err());
        let long = "é".repeat(MAX_MARK_CHARS);
        assert!(check_marks(&[mark(5, 5, &long, None)], 10, 10).is_ok());
        assert!(check_marks(&[mark(5, 5, &format!("{long}x"), None)], 10, 10).is_err());
        let many = vec![mark(1, 1, "A", None); MAX_MARKS + 1];
        assert!(check_marks(&many, 10, 10).is_err());
    }

    #[test]
    fn files_of_images_are_told_from_the_others() {
        assert_eq!(
            image_of_file("00112233445566ff.png"),
            Some("00112233445566ff")
        );
        assert_eq!(
            image_of_file("00112233445566ff.jpg"),
            Some("00112233445566ff")
        );
        assert_eq!(
            image_of_file("00112233445566ff.thumb.png"),
            Some("00112233445566ff")
        );
        assert_eq!(image_of_file("00112233445566ff.json"), None);
        assert_eq!(image_of_file("lists.json"), None);
        assert_eq!(image_of_file("notes.png"), None);
        assert_eq!(image_of_file("00112233445566ff.png.tmp"), None);
    }
}
