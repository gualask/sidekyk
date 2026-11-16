//! The store's write of a capture's note: its crops, their marks and its text in one change, a
//! new note on top of a list or a note there; files first, then the note, so a failure leaves
//! the book as it was.

use super::images::{image_of_note, with_marks, write_image};
use super::notes::target_note;
use super::{now, NotesStore};
use crate::modules::notes::book::NoteBook;
use crate::modules::notes::contracts::{Book, ImageTarget, Mark, Note, NoteImage};
use crate::modules::notes::images::PreparedImage;
use crate::modules::notes::ports::NotesStorage;

/// An image of a capture's note: a crop new to it, or one of the note's own marked anew. `drawn`
/// is the PNG of `marks` over the image under them; none without marks.
pub enum CaptureImage<'a> {
    New {
        image: &'a PreparedImage,
        marks: Vec<Mark>,
        drawn: Option<PreparedImage>,
    },
    Remarked {
        id: String,
        marks: Vec<Mark>,
        drawn: Option<PreparedImage>,
    },
}

/// What a capture writes: where, its text (unchanged when none), its images in order.
pub struct CaptureWrite<'a> {
    pub target: ImageTarget,
    pub text: Option<String>,
    pub images: Vec<CaptureImage<'a>>,
}

impl NotesStore {
    /// Writes a capture's note in one change: a new note on top of a list with its crops, or a
    /// note there given its crops below its images, its images marked anew and its text.
    pub fn write_capture(
        &self,
        storage: &dyn NotesStorage,
        book: &Book,
        write: CaptureWrite<'_>,
    ) -> anyhow::Result<Note> {
        let CaptureWrite {
            target,
            text,
            images,
        } = write;
        if let ImageTarget::New { .. } = target {
            anyhow::ensure!(
                images.iter().any(|i| matches!(i, CaptureImage::New { .. })),
                "a capture's new note has a crop"
            );
        }
        self.change_kept(storage, book, |kept| {
            let folder = self.folder(storage, book, kept)?;
            let mut written = Written::default();
            for image in images {
                written.write(storage, &folder, &kept.notes, &target, image)?;
            }
            let notes = &mut kept.notes;
            let now = now();
            let (id, mut touched) = target_note(notes, target, text, now)?;
            touched.extend(notes.add_images(&id, written.added, now)?.1);
            for (replaced, image) in written.remarked {
                touched.extend(notes.replace_image(&id, &replaced, image, now)?.1);
            }
            touched.dedup();
            Ok((notes.find(&id)?.clone(), touched))
        })
    }
}

/// A capture's images written so far: the crops added, in order, and the note's images marked
/// anew, by the id they replace.
#[derive(Default)]
struct Written {
    added: Vec<NoteImage>,
    remarked: Vec<(String, NoteImage)>,
}

impl Written {
    /// Writes `image`'s files in `folder`, under ids none of `book`'s images has nor one written
    /// before it.
    fn write(
        &mut self,
        storage: &dyn NotesStorage,
        folder: &str,
        book: &NoteBook,
        target: &ImageTarget,
        image: CaptureImage<'_>,
    ) -> anyhow::Result<()> {
        match image {
            CaptureImage::New {
                image,
                marks,
                drawn,
            } => {
                let given = write_image(storage, folder, book, &self.added, image)?;
                self.added.push(given.clone());
                // the image as the note keeps it, under its marks when marked
                let kept = with_marks(storage, folder, book, &self.added, given, marks, drawn)?;
                *self.added.last_mut().expect("just added") = kept;
            }
            CaptureImage::Remarked { id, marks, drawn } => {
                let ImageTarget::Note { id: note } = target else {
                    anyhow::bail!("a new note has no image to mark anew");
                };
                let source = image_of_note(book, note, &id)?.source();
                let taken: Vec<NoteImage> = self
                    .added
                    .iter()
                    .chain(self.remarked.iter().map(|(_, i)| i))
                    .cloned()
                    .collect();
                let replacement = with_marks(storage, folder, book, &taken, source, marks, drawn)?;
                self.remarked.push((id, replacement));
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::Ordering;

    use super::super::images::tests::{files_of, letter, marked_screenshot, screenshot};
    use super::super::tests::*;
    use super::*;
    use crate::modules::notes::images::{image_file, thumb_file};

    fn new_in(store: &NotesStore, storage: &MemoryStorage) -> ImageTarget {
        let list = store.notes(storage, &shop()).unwrap().open_list;
        ImageTarget::New { list }
    }

    #[test]
    fn a_new_note_takes_its_crops_their_marks_and_its_text_in_one_write() {
        let storage = MemoryStorage::default();
        let store = NotesStore::default();
        let (first, second) = (screenshot(), screenshot());
        let target = new_in(&store, &storage);
        let note = store
            .write_capture(
                &storage,
                &shop(),
                CaptureWrite {
                    target,
                    text: Some("the button is off".into()),
                    images: vec![
                        CaptureImage::New {
                            image: &first,
                            marks: vec![letter("A")],
                            drawn: Some(marked_screenshot()),
                        },
                        CaptureImage::New {
                            image: &second,
                            marks: Vec::new(),
                            drawn: None,
                        },
                    ],
                },
            )
            .unwrap();
        assert_eq!(note.text, "the button is off");
        assert_eq!(note.images.len(), 2);
        let (marked, plain) = (&note.images[0], &note.images[1]);
        let under = marked.marked.as_ref().unwrap();
        assert_eq!(under.marks, [letter("A")]);
        assert!(plain.marked.is_none());
        // every id its own: the marked, the one under it, the plain one
        let mut ids: Vec<&str> = note.images.iter().flat_map(|i| i.ids()).collect();
        ids.sort();
        ids.dedup();
        assert_eq!(ids.len(), 3);
        for image in [marked, &marked.source(), plain] {
            assert!(
                store
                    .image(&storage, &shop(), &image_file(image))
                    .unwrap()
                    .is_some(),
                "{}",
                image.id
            );
        }
        assert!(files_of(&storage, plain).contains(&thumb_file(&plain.id)));
        assert_eq!(store.notes(&storage, &shop()).unwrap().notes, [note]);
    }

    #[test]
    fn a_note_there_takes_crops_below_its_images_its_marks_anew_and_its_text() {
        let storage = MemoryStorage::default();
        let store = NotesStore::default();
        let target = new_in(&store, &storage);
        let (given, crop) = (screenshot(), screenshot());
        let note = store
            .write_capture(
                &storage,
                &shop(),
                CaptureWrite {
                    target,
                    text: None,
                    images: vec![CaptureImage::New {
                        image: &given,
                        marks: Vec::new(),
                        drawn: None,
                    }],
                },
            )
            .unwrap();
        let first = note.images[0].clone();
        let written = store
            .write_capture(
                &storage,
                &shop(),
                CaptureWrite {
                    target: ImageTarget::Note {
                        id: note.id.clone(),
                    },
                    text: Some("two places".into()),
                    images: vec![
                        CaptureImage::Remarked {
                            id: first.id.clone(),
                            marks: vec![letter("A")],
                            drawn: Some(marked_screenshot()),
                        },
                        CaptureImage::New {
                            image: &crop,
                            marks: vec![letter("B")],
                            drawn: Some(marked_screenshot()),
                        },
                    ],
                },
            )
            .unwrap();
        assert_eq!(written.id, note.id);
        assert_eq!(written.text, "two places");
        assert_eq!(written.images.len(), 2);
        assert_eq!(written.images[0].source(), first);
        assert_eq!(
            written.images[0].marked.as_ref().unwrap().marks,
            [letter("A")]
        );
        assert_eq!(
            written.images[1].marked.as_ref().unwrap().marks,
            [letter("B")]
        );
        assert_eq!(store.notes(&storage, &shop()).unwrap().notes, [written]);
    }

    #[test]
    fn a_failed_write_leaves_the_book_as_it_was() {
        let storage = MemoryStorage::default();
        let store = NotesStore::default();
        let target = new_in(&store, &storage);
        let before = store.notes(&storage, &shop()).unwrap();
        let crop = screenshot();
        storage.fail_writes.store(true, Ordering::Relaxed);
        let failed = store.write_capture(
            &storage,
            &shop(),
            CaptureWrite {
                target,
                text: Some("lost?".into()),
                images: vec![CaptureImage::New {
                    image: &crop,
                    marks: Vec::new(),
                    drawn: None,
                }],
            },
        );
        assert!(failed.is_err());
        storage.fail_writes.store(false, Ordering::Relaxed);
        assert_eq!(store.notes(&storage, &shop()).unwrap(), before);
    }

    #[test]
    fn a_write_that_cannot_hold_is_refused() {
        let storage = MemoryStorage::default();
        let store = NotesStore::default();
        let target = new_in(&store, &storage);
        let crop = screenshot();
        let write = |target: ImageTarget, images| {
            store.write_capture(
                &storage,
                &shop(),
                CaptureWrite {
                    target,
                    text: None,
                    images,
                },
            )
        };
        // a new note without a crop, or with an image of its own to mark
        assert!(write(target.clone(), Vec::new()).is_err());
        assert!(write(
            target.clone(),
            vec![
                CaptureImage::New {
                    image: &crop,
                    marks: Vec::new(),
                    drawn: None,
                },
                CaptureImage::Remarked {
                    id: "0123456789abcdef".into(),
                    marks: Vec::new(),
                    drawn: None,
                },
            ],
        )
        .is_err());
        // marks without the PNG drawn with them
        assert!(write(
            target,
            vec![CaptureImage::New {
                image: &crop,
                marks: vec![letter("A")],
                drawn: None,
            }],
        )
        .is_err());
        assert!(store.notes(&storage, &shop()).unwrap().notes.is_empty());
    }
}
