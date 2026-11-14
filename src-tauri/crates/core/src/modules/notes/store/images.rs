//! The store's images of notes: added, marked or taken out, written before the notes that name
//! them, read back, and copied with a note moved to another book.

use super::notes::new_note_id;
use super::{now, KeptBook, NotesStore};
use crate::modules::notes::book::{NoteBook, Touched};
use crate::modules::notes::contracts::{
    Book, ImageKind, ImageTarget, Mark, MarkedImage, Note, NoteImage, SourceImage,
};
use crate::modules::notes::images::{
    check_marks, file_named, image_file, image_files, image_of_file, thumb_file, PreparedImage,
    MAX_IMAGE_BYTES,
};
use crate::modules::notes::ports::NotesStorage;
use crate::shared::id::new_id;
use crate::shared::sync::lock;

/// A new id no image of `book` has, nor one of `taken`.
pub(super) fn new_image_id(book: &NoteBook, taken: &[NoteImage]) -> String {
    let used = |id: &str| {
        taken.iter().any(|i| i.ids().any(|used| used == id))
            || book
                .notes
                .iter()
                .flat_map(|n| &n.images)
                .any(|i| i.ids().any(|used| used == id))
    };
    let mut id = new_id();
    while used(&id) {
        id = new_id();
    }
    id
}

impl NotesStore {
    /// Adds images to a note, or to a new one on top of a list: their files first, then the note
    /// that names them. Files written for a change that fails are removed at the next session.
    pub fn add_images(
        &self,
        storage: &dyn NotesStorage,
        book: &Book,
        target: ImageTarget,
        images: Vec<PreparedImage>,
    ) -> anyhow::Result<Note> {
        anyhow::ensure!(!images.is_empty(), "no image to add");
        self.change_kept(storage, book, |kept| {
            let folder = self.folder(storage, book, kept)?;
            let mut added: Vec<NoteImage> = Vec::with_capacity(images.len());
            for image in &images {
                let note_image = write_image(storage, &folder, &kept.notes, &added, image)?;
                added.push(note_image);
            }
            let notes = &mut kept.notes;
            let now = now();
            match target {
                ImageTarget::Note { id } => notes.add_images(&id, added, now),
                ImageTarget::New { list } => {
                    let id = new_note_id(notes);
                    let (_, mut touched) = notes.add(id.clone(), &list, String::new(), now)?;
                    let (note, more) = notes.add_images(&id, added, now)?;
                    touched.extend(more);
                    Ok((note, touched))
                }
            }
        })
    }

    /// Takes an image out of a note; `restore_note` with the note as it was puts it back.
    pub fn remove_image(
        &self,
        storage: &dyn NotesStorage,
        book: &Book,
        id: &str,
        image: &str,
    ) -> anyhow::Result<Note> {
        self.change(storage, book, |notes| notes.remove_image(id, image, now()))
    }

    /// Marks a note's image anew: `marked`, the PNG drawn with `marks` over the image as given,
    /// takes its place with a new id; no marks give the image as given back. The files of a
    /// marked image replaced stay until the book is next read, as a removed image's.
    pub fn mark_image(
        &self,
        storage: &dyn NotesStorage,
        book: &Book,
        id: &str,
        image: &str,
        marks: Vec<Mark>,
        marked: Option<PreparedImage>,
    ) -> anyhow::Result<Note> {
        self.change_kept(storage, book, |kept| {
            let source = image_of_note(&kept.notes, id, image)?.source();
            let replacement = if marks.is_empty() {
                source
            } else {
                let marked =
                    marked.ok_or_else(|| anyhow::anyhow!("marks come with their image"))?;
                let folder = self.folder(storage, book, kept)?;
                write_marked(storage, &folder, &kept.notes, &[], source, marks, marked)?
            };
            kept.notes.replace_image(id, image, replacement, now())
        })
    }

    /// The bytes of an image of a note, or of its thumbnail (PNG), by the name of its file, and
    /// their kind; `None` for a file no note of the book has. Read outside the lock.
    pub fn image(
        &self,
        storage: &dyn NotesStorage,
        book: &Book,
        file: &str,
    ) -> anyhow::Result<Option<(ImageKind, Vec<u8>)>> {
        let Some(id) = image_of_file(file) else {
            return Ok(None);
        };
        let Some((folder, kind)) = self.stored_image(storage, book, file, id)? else {
            return Ok(None);
        };
        Ok(storage
            .read(&folder, file, MAX_IMAGE_BYTES)?
            .map(|bytes| (kind, bytes)))
    }

    /// The folder of `file`, a file of the image `id` some note of `book` has, and its kind.
    fn stored_image(
        &self,
        storage: &dyn NotesStorage,
        book: &Book,
        file: &str,
        id: &str,
    ) -> anyhow::Result<Option<(String, ImageKind)>> {
        let mut books = lock(&self.books);
        let kept = self.kept_book(&mut books, storage, book)?;
        // an image, or the one under its marks
        let kind = kept
            .notes
            .notes
            .iter()
            .flat_map(|n| &n.images)
            .find_map(|i| i.kind_of(id));
        Ok(match (kind, &kept.folder) {
            (Some(_), Some(folder)) if file == thumb_file(id) => {
                Some((folder.clone(), ImageKind::Png))
            }
            (Some(kind), Some(folder)) if file == file_named(id, kind) => {
                Some((folder.clone(), kind))
            }
            _ => None,
        })
    }

    /// A note's text and where its images are, in their order: what its copy is made of.
    pub fn note_copy(
        &self,
        storage: &dyn NotesStorage,
        book: &Book,
        id: &str,
    ) -> anyhow::Result<(String, Vec<String>)> {
        let mut books = lock(&self.books);
        let kept = self.kept_book(&mut books, storage, book)?;
        let note = kept.notes.find(id)?;
        let mut images = Vec::with_capacity(note.images.len());
        if let Some(folder) = &kept.folder {
            for image in &note.images {
                images.push(storage.location(folder, &image_file(image))?);
            }
        }
        Ok((note.text.clone(), images))
    }

    /// Copies the image files of the notes a book took in (`took`) from the folder of the book
    /// they came from: written before the notes that name them.
    pub(super) fn carry_images(
        &self,
        storage: &dyn NotesStorage,
        taker: &Book,
        taking: &mut KeptBook,
        from: Option<&str>,
        took: &[Touched],
    ) -> anyhow::Result<()> {
        let Some(from) = from else {
            return Ok(());
        };
        let images: Vec<NoteImage> = took
            .iter()
            .filter_map(|touched| match touched {
                Touched::Note(id) => taking.notes.note(id),
                _ => None,
            })
            .flat_map(|note| note.images.iter().cloned())
            .collect();
        if images.is_empty() {
            return Ok(());
        }
        let to = self.folder(storage, taker, taking)?;
        for file in images.iter().flat_map(image_files) {
            if let Some(bytes) = storage.read(from, &file, MAX_IMAGE_BYTES)? {
                storage.write(&to, &file, &bytes)?;
            }
        }
        Ok(())
    }
}

/// Writes in `folder` the files of `marked`, drawn with `marks` over `source`: the image that
/// takes `source`'s place, kept under the marks; its id none of `book`'s images has nor one of
/// `taken`, the images the same change writes.
pub(super) fn write_marked(
    storage: &dyn NotesStorage,
    folder: &str,
    book: &NoteBook,
    taken: &[NoteImage],
    source: NoteImage,
    marks: Vec<Mark>,
    marked: PreparedImage,
) -> anyhow::Result<NoteImage> {
    anyhow::ensure!(
        marked.kind == ImageKind::Png
            && (marked.width, marked.height) == (source.width, source.height),
        "a marked image is a PNG as large as the image under it"
    );
    check_marks(&marks, source.width, source.height)?;
    let drawn = write_image(storage, folder, book, taken, &marked)?;
    Ok(NoteImage {
        marked: Some(MarkedImage {
            source: SourceImage::of(source),
            marks,
        }),
        ..drawn
    })
}

/// Writes `image`'s file and thumbnail in `folder`, under an id none of `book`'s images has nor
/// one of `taken`: the image a note keeps of it.
pub(super) fn write_image(
    storage: &dyn NotesStorage,
    folder: &str,
    book: &NoteBook,
    taken: &[NoteImage],
    image: &PreparedImage,
) -> anyhow::Result<NoteImage> {
    let note_image = image.note_image(new_image_id(book, taken));
    storage.write(folder, &image_file(&note_image), &image.original)?;
    storage.write(folder, &thumb_file(&note_image.id), &image.thumb)?;
    Ok(note_image)
}

/// The image `image` of the note `id` in `book`.
pub(super) fn image_of_note<'a>(
    book: &'a NoteBook,
    id: &str,
    image: &str,
) -> anyhow::Result<&'a NoteImage> {
    book.find(id)?
        .images
        .iter()
        .find(|i| i.id == image)
        .ok_or_else(|| anyhow::anyhow!("no image {image} in note {id}"))
}

#[cfg(test)]
pub(super) mod tests {
    use std::sync::atomic::Ordering;

    use super::super::tests::*;
    use super::*;
    use crate::modules::notes::contracts::ListTarget;
    use crate::modules::notes::files::{note_file, LISTS_FILE, PROJECT_FILE};

    pub(in crate::modules::notes) fn screenshot() -> PreparedImage {
        let png = crate::modules::notes::images::tests::encoded(64, 32, image::ImageFormat::Png);
        crate::modules::notes::images::prepare(png).unwrap()
    }

    pub(in crate::modules::notes) fn files_of(
        storage: &MemoryStorage,
        image: &NoteImage,
    ) -> Vec<String> {
        storage
            .names()
            .into_iter()
            .map(|(_, file)| file)
            .filter(|file| file.starts_with(&image.id))
            .collect()
    }

    #[test]
    fn images_make_a_new_note_their_files_written_first() {
        let storage = MemoryStorage::default();
        let store = NotesStore::default();
        let general = store.notes(&storage, &shop()).unwrap().open_list;
        let note = store
            .add_images(
                &storage,
                &shop(),
                ImageTarget::New { list: general },
                vec![screenshot(), screenshot()],
            )
            .unwrap();
        assert_eq!(note.text, "");
        assert_eq!(note.images.len(), 2);
        assert_ne!(note.images[0].id, note.images[1].id);
        assert_eq!((note.images[0].width, note.images[0].height), (64, 32));
        let image = &note.images[0];
        let mut files = files_of(&storage, image);
        files.sort();
        assert_eq!(files, [image_file(image), thumb_file(&image.id)]);
        // the project's folder and lists came with them
        assert!(storage.names().iter().any(|(_, f)| f == PROJECT_FILE));
        assert!(storage.names().iter().any(|(_, f)| f == LISTS_FILE));

        let (kind, bytes) = store
            .image(&storage, &shop(), &image_file(image))
            .unwrap()
            .unwrap();
        assert_eq!(kind, ImageKind::Png);
        assert_eq!(bytes.len() as u64, image.bytes);
        let (kind, _) = store
            .image(&storage, &shop(), &thumb_file(&image.id))
            .unwrap()
            .unwrap();
        assert_eq!(kind, ImageKind::Png);
        assert!(store
            .image(&storage, &shop(), "0000000000000000.png")
            .unwrap()
            .is_none());
        assert!(store
            .image(&storage, &shop(), &note_file(&note.id))
            .unwrap()
            .is_none());
    }

    #[test]
    fn images_join_a_note_below_its_own() {
        let storage = MemoryStorage::default();
        let store = NotesStore::default();
        let general = store.notes(&storage, &shop()).unwrap().open_list;
        let note = store
            .add_note(&storage, &shop(), &general, "the rail".into())
            .unwrap();
        let first = store
            .add_images(
                &storage,
                &shop(),
                ImageTarget::Note {
                    id: note.id.clone(),
                },
                vec![screenshot()],
            )
            .unwrap();
        let second = store
            .add_images(
                &storage,
                &shop(),
                ImageTarget::Note { id: note.id },
                vec![screenshot()],
            )
            .unwrap();
        assert_eq!(second.text, "the rail");
        assert_eq!(second.images.len(), 2);
        assert_eq!(second.images[0], first.images[0]);
        let read = NotesStore::default().notes(&storage, &shop()).unwrap();
        assert_eq!(read.notes[0].images, second.images);
    }

    #[test]
    fn an_image_taken_out_keeps_its_files_until_the_next_session() {
        let storage = MemoryStorage::default();
        let store = NotesStore::default();
        let general = store.notes(&storage, &shop()).unwrap().open_list;
        let note = store
            .add_images(
                &storage,
                &shop(),
                ImageTarget::New { list: general },
                vec![screenshot()],
            )
            .unwrap();
        let image = note.images[0].clone();
        store
            .remove_image(&storage, &shop(), &note.id, &image.id)
            .unwrap();
        assert_eq!(files_of(&storage, &image).len(), 2);
        // undone: the note as it was finds its files
        store.restore_note(&storage, &shop(), note.clone()).unwrap();
        assert!(store
            .image(&storage, &shop(), &image_file(&image))
            .unwrap()
            .is_some());

        store.delete_note(&storage, &shop(), &note.id).unwrap();
        // the next session's first read removes them
        NotesStore::default().notes(&storage, &shop()).unwrap();
        assert!(files_of(&storage, &image).is_empty());
    }

    #[test]
    fn a_session_reading_a_book_twice_removes_its_stray_images_once() {
        let storage = MemoryStorage::default();
        let store = NotesStore::default();
        let general = store.notes(&storage, &shop()).unwrap().open_list;
        let note = store
            .add_images(
                &storage,
                &shop(),
                ImageTarget::New { list: general },
                vec![screenshot()],
            )
            .unwrap();
        let image = note.images[0].clone();

        let next = NotesStore::default();
        next.notes(&storage, &shop()).unwrap();
        next.delete_note(&storage, &shop(), &note.id).unwrap();
        // a failed write drops the book; read again, it keeps the files for an undo
        storage.fail_writes.store(true, Ordering::Relaxed);
        let general = next.notes(&storage, &shop()).unwrap().open_list;
        assert!(next
            .add_note(&storage, &shop(), &general, "x".into())
            .is_err());
        storage.fail_writes.store(false, Ordering::Relaxed);
        next.notes(&storage, &shop()).unwrap();
        assert_eq!(files_of(&storage, &image).len(), 2);
    }

    #[test]
    fn a_book_refused_keeps_every_image() {
        let storage = MemoryStorage::default();
        let store = NotesStore::default();
        let general = store.notes(&storage, &shop()).unwrap().open_list;
        let note = store
            .add_images(
                &storage,
                &shop(),
                ImageTarget::New { list: general },
                vec![screenshot()],
            )
            .unwrap();
        let folder = storage.names()[0].0.clone();
        storage
            .write(&folder, &note_file(&note.id), b"{ broken")
            .unwrap();
        assert!(refused(NotesStore::default().notes(&storage, &shop())));
        assert_eq!(files_of(&storage, &note.images[0]).len(), 2);
    }

    #[test]
    fn a_note_moved_takes_copies_of_its_images() {
        let storage = MemoryStorage::default();
        let store = NotesStore::default();
        let general = store.notes(&storage, &shop()).unwrap().open_list;
        let note = store
            .add_images(
                &storage,
                &shop(),
                ImageTarget::New { list: general },
                vec![screenshot()],
            )
            .unwrap();
        let image = note.images[0].clone();
        let moved = store
            .move_note(&storage, &shop(), &note.id, &docs(), ListTarget::Open)
            .unwrap();
        assert_eq!(moved.note.images, note.images);
        assert!(store
            .image(&storage, &docs(), &image_file(&image))
            .unwrap()
            .is_some());
        // both folders hold them until the next session, so an undo finds them
        assert_eq!(files_of(&storage, &image).len(), 4);

        let next = NotesStore::default();
        next.notes(&storage, &shop()).unwrap();
        next.notes(&storage, &docs()).unwrap();
        assert_eq!(files_of(&storage, &image).len(), 2);
        assert!(next
            .image(&storage, &docs(), &thumb_file(&image.id))
            .unwrap()
            .is_some());
    }

    #[test]
    fn a_copy_names_where_the_images_are() {
        let storage = MemoryStorage::default();
        let store = NotesStore::default();
        let general = store.notes(&storage, &shop()).unwrap().open_list;
        let note = store
            .add_images(
                &storage,
                &shop(),
                ImageTarget::New { list: general },
                vec![screenshot()],
            )
            .unwrap();
        let note = store
            .set_note_text(&storage, &shop(), &note.id, "look".into())
            .unwrap();
        let folder = storage.names()[0].0.clone();
        let (text, images) = store.note_copy(&storage, &shop(), &note.id).unwrap();
        assert_eq!(text, "look");
        assert_eq!(
            images,
            [format!(
                "/data/notes/{folder}/{}",
                image_file(&note.images[0])
            )]
        );
    }

    /// `screenshot()` drawn over: a PNG as large, with other pixels.
    pub(in crate::modules::notes) fn marked_screenshot() -> PreparedImage {
        let mut png = std::io::Cursor::new(Vec::new());
        image::DynamicImage::ImageRgb8(image::RgbImage::from_pixel(
            64,
            32,
            image::Rgb([229, 72, 77]),
        ))
        .write_to(&mut png, image::ImageFormat::Png)
        .unwrap();
        crate::modules::notes::images::prepare(png.into_inner()).unwrap()
    }

    pub(in crate::modules::notes) fn letter(text: &str) -> Mark {
        Mark {
            x: 10,
            y: 10,
            text: text.into(),
            tail: Some(crate::modules::notes::contracts::MarkPoint { x: 40, y: 20 }),
        }
    }

    /// A note of `shop()` with `screenshot()`, then that image marked with an A.
    fn a_marked_note(storage: &MemoryStorage, store: &NotesStore) -> (Note, Note) {
        let general = store.notes(storage, &shop()).unwrap().open_list;
        let note = store
            .add_images(
                storage,
                &shop(),
                ImageTarget::New { list: general },
                vec![screenshot()],
            )
            .unwrap();
        let marked = store
            .mark_image(
                storage,
                &shop(),
                &note.id,
                &note.images[0].id,
                vec![letter("A")],
                Some(marked_screenshot()),
            )
            .unwrap();
        (note, marked)
    }

    #[test]
    fn a_marked_image_takes_the_place_of_the_one_under_it_and_keeps_it() {
        let storage = MemoryStorage::default();
        let store = NotesStore::default();
        let (note, marked) = a_marked_note(&storage, &store);
        let given = &note.images[0];
        let image = &marked.images[0];
        assert_eq!(marked.images.len(), 1);
        assert_ne!(image.id, given.id);
        assert_eq!(
            (image.kind, image.width, image.height),
            (ImageKind::Png, 64, 32)
        );
        let under = image.marked.as_ref().unwrap();
        assert_eq!(under.source.id, given.id);
        assert_eq!(under.marks, [letter("A")]);
        assert_eq!(image.source(), *given);
        // the marked image, its thumbnail and the image under it are served
        for (id, file) in [
            (&image.id, image_file(image)),
            (&image.id, thumb_file(&image.id)),
            (&given.id, image_file(given)),
        ] {
            assert!(
                store.image(&storage, &shop(), &file).unwrap().is_some(),
                "{id}: {file}"
            );
        }
        assert_eq!(
            store.notes(&storage, &shop()).unwrap().notes[0].images,
            marked.images
        );
        let folder = storage.names()[0].0.clone();
        let (_, copied) = store.note_copy(&storage, &shop(), &note.id).unwrap();
        assert_eq!(
            copied,
            [format!("/data/notes/{folder}/{}", image_file(image))]
        );
    }

    #[test]
    fn marked_again_it_keeps_the_image_given_and_without_marks_gives_it_back() {
        let storage = MemoryStorage::default();
        let store = NotesStore::default();
        let (note, marked) = a_marked_note(&storage, &store);
        let again = store
            .mark_image(
                &storage,
                &shop(),
                &note.id,
                &marked.images[0].id,
                vec![letter("A"), letter("B")],
                Some(marked_screenshot()),
            )
            .unwrap();
        let image = &again.images[0];
        assert_ne!(image.id, marked.images[0].id);
        assert_eq!(image.source(), note.images[0]);
        assert_eq!(image.marked.as_ref().unwrap().marks.len(), 2);
        let back = store
            .mark_image(&storage, &shop(), &note.id, &image.id, Vec::new(), None)
            .unwrap();
        assert_eq!(back.images, note.images);
    }

    #[test]
    fn marks_come_with_a_png_as_large_as_the_image_under_them() {
        let storage = MemoryStorage::default();
        let store = NotesStore::default();
        let (note, marked) = a_marked_note(&storage, &store);
        let id = &marked.images[0].id;
        let mark = |marks, drawn| store.mark_image(&storage, &shop(), &note.id, id, marks, drawn);
        assert!(mark(vec![letter("A")], None).is_err());
        let small = crate::modules::notes::images::prepare(
            crate::modules::notes::images::tests::encoded(32, 32, image::ImageFormat::Png),
        )
        .unwrap();
        assert!(mark(vec![letter("A")], Some(small)).is_err());
        let jpeg = crate::modules::notes::images::prepare(
            crate::modules::notes::images::tests::encoded(64, 32, image::ImageFormat::Jpeg),
        )
        .unwrap();
        assert!(mark(vec![letter("A")], Some(jpeg)).is_err());
        let outside = Mark {
            x: 65,
            ..letter("A")
        };
        assert!(mark(vec![outside], Some(marked_screenshot())).is_err());
        assert_eq!(store.notes(&storage, &shop()).unwrap().notes[0], marked);
    }

    #[test]
    fn the_image_under_marks_outlives_the_sessions_and_moves_with_its_note() {
        let storage = MemoryStorage::default();
        let store = NotesStore::default();
        let (note, marked) = a_marked_note(&storage, &store);
        let given = note.images[0].clone();
        let image = marked.images[0].clone();
        let next = NotesStore::default();
        next.notes(&storage, &shop()).unwrap();
        assert_eq!(files_of(&storage, &given).len(), 2);
        assert_eq!(files_of(&storage, &image).len(), 2);

        next.move_note(&storage, &shop(), &note.id, &docs(), ListTarget::Open)
            .unwrap();
        for file in [
            image_file(&image),
            image_file(&given),
            thumb_file(&given.id),
        ] {
            assert!(
                next.image(&storage, &docs(), &file).unwrap().is_some(),
                "{file}"
            );
        }
    }
}
