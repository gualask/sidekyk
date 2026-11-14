//! Capture's commands: a capture started for a place, its crops written as a note or dropped,
//! a crop as PNG, the system's permission (`desktop/capture.rs`); its crops for the webview in
//! `image_scheme.rs`.

pub(crate) mod image_scheme;

use serde::Deserialize;
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

use super::blocking::with_notes;
use crate::desktop::capture::{self, CAPTURE_BUILT, SETTINGS_URL};
use sidekyk_core::modules::capture::CaptureInto;
use sidekyk_core::modules::notes::{prepare, CaptureImage, CaptureWrite, ImageTarget, Mark, Note};
use sidekyk_core::shared::error::AppError;

#[tauri::command]
/// Whether this system captures: Notes' button shows only then.
pub(crate) fn can_capture() -> bool {
    CAPTURE_BUILT
}

#[tauri::command]
/// Starts a capture going `into` a place: Notes' button, a note's "Add capture", the capture
/// window's +.
pub(crate) fn start_capture(app: AppHandle, into: CaptureInto) {
    capture::capture(&app, into);
}

/// A capture's note as the page writes it, before the PNGs drawn with its images' marks: the
/// body's first line.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Written {
    book: String,
    target: ImageTarget,
    /// The note's text; none leaves an existing note's as it is.
    text: Option<String>,
    images: Vec<WrittenImage>,
}

/// An image of the note: a crop, or one of the note's own marked anew; `png`, the length of the
/// PNG drawn with its marks in the body (0 without marks).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
enum WrittenImage {
    Crop {
        crop: String,
        marks: Vec<Mark>,
        png: usize,
    },
    Image {
        id: String,
        marks: Vec<Mark>,
        png: usize,
    },
}

impl WrittenImage {
    fn png(&self) -> usize {
        match self {
            Self::Crop { png, .. } | Self::Image { png, .. } => *png,
        }
    }
}

#[tauri::command]
/// Writes a capture's note in one change: its crops, their marks, the note's images marked anew
/// and its text. The body is the note as JSON, a line of its own (JSON escapes every line end in
/// it), then each image's PNG drawn with its marks, raw, back to back. The crops go once
/// written; a failure keeps them, for the draft to try again.
pub(crate) async fn write_capture(
    app: AppHandle,
    request: tauri::ipc::Request<'_>,
) -> Result<Note, AppError> {
    let tauri::ipc::InvokeBody::Raw(body) = request.body() else {
        return Err(anyhow::anyhow!("a capture's note comes raw").into());
    };
    let (written, pngs) = written(body).map_err(AppError::from)?;
    let ids: Vec<String> = written
        .images
        .iter()
        .filter_map(|image| match image {
            WrittenImage::Crop { crop, .. } => Some(crop.clone()),
            WrittenImage::Image { .. } => None,
        })
        .collect();
    let crops = capture::crops(&app, &ids).map_err(AppError::from)?;
    let Written {
        book,
        target,
        text,
        images,
    } = written;
    let note = with_notes(
        "write_capture",
        app.clone(),
        book,
        move |store, files, book| {
            let mut crops = crops.iter();
            let mut kept = Vec::with_capacity(images.len());
            for (image, png) in images.into_iter().zip(pngs) {
                let drawn = (!png.is_empty()).then(|| prepare(png)).transpose()?;
                kept.push(match image {
                    WrittenImage::Crop { marks, .. } => CaptureImage::New {
                        image: crops
                            .next()
                            .ok_or_else(|| anyhow::anyhow!("a crop missing"))?,
                        marks,
                        drawn,
                    },
                    WrittenImage::Image { id, marks, .. } => {
                        CaptureImage::Remarked { id, marks, drawn }
                    }
                });
            }
            store.write_capture(
                files,
                book,
                CaptureWrite {
                    target,
                    text,
                    images: kept,
                },
            )
        },
    )
    .await?;
    capture::drop_crops(&app, &ids);
    Ok(note)
}

/// A capture's note and the PNGs of its images, from the body that carries them.
fn written(body: &[u8]) -> anyhow::Result<(Written, Vec<Vec<u8>>)> {
    let end = body
        .iter()
        .position(|byte| *byte == b'\n')
        .ok_or_else(|| anyhow::anyhow!("a capture's note ends its line"))?;
    let written: Written = serde_json::from_slice(&body[..end])?;
    let mut rest = &body[end + 1..];
    let mut pngs = Vec::with_capacity(written.images.len());
    for image in &written.images {
        anyhow::ensure!(image.png() <= rest.len(), "a PNG shorter than told");
        let (png, after) = rest.split_at(image.png());
        pngs.push(png.to_vec());
        rest = after;
    }
    anyhow::ensure!(rest.is_empty(), "bytes past the PNGs told");
    Ok((written, pngs))
}

#[tauri::command]
/// Drops crops a draft let go (its ×, `Esc`).
pub(crate) fn drop_crops(app: AppHandle, crops: Vec<String>) {
    capture::drop_crops(&app, &crops);
}

#[tauri::command]
/// A crop's PNG, for its marks to be drawn over it. Raw bytes, not a JSON array.
pub(crate) fn crop_png(app: AppHandle, crop: String) -> Result<tauri::ipc::Response, AppError> {
    let image = capture::crops(&app, &[crop])
        .map_err(AppError::from)?
        .pop()
        .ok_or_else(|| AppError::from(anyhow::anyhow!("no crop")))?;
    Ok(tauri::ipc::Response::new(image.original.clone()))
}

#[tauri::command]
/// Opens the system's settings where Sidekyk may be let read the screen.
pub(crate) fn open_capture_settings(app: AppHandle) -> Result<(), AppError> {
    if let Some(url) = SETTINGS_URL {
        app.opener()
            .open_url(url, None::<&str>)
            .map_err(|error| AppError::from(anyhow::Error::from(error)))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_capture_note_is_a_line_of_json_then_its_pngs_back_to_back() {
        let json = r#"{"book":"inbox","target":{"kind":"new","list":"0123456789abcdef"},"text":"A\nB","images":[{"kind":"crop","crop":"c1","marks":[],"png":0},{"kind":"image","id":"i1","marks":[{"x":1,"y":2,"text":"A","tail":null}],"png":3},{"kind":"crop","crop":"c2","marks":[],"png":2}]}"#;
        let mut body = json.as_bytes().to_vec();
        body.push(b'\n');
        body.extend_from_slice(b"abcde");
        let (written, pngs) = written(&body).unwrap();
        assert_eq!(written.book, "inbox");
        assert_eq!(written.text.as_deref(), Some("A\nB"));
        assert_eq!(pngs, [b"".to_vec(), b"abc".to_vec(), b"de".to_vec()]);
        assert!(matches!(
            &written.images[1],
            WrittenImage::Image { id, marks, .. } if id == "i1" && marks.len() == 1
        ));
        // lengths that do not add up
        let short = [json.as_bytes(), b"\nabcd"].concat();
        assert!(super::written(&short).is_err());
        let long = [json.as_bytes(), b"\nabcdef"].concat();
        assert!(super::written(&long).is_err());
        assert!(super::written(json.as_bytes()).is_err());
    }
}
