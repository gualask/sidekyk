//! Notes over the project list: a book is the Inbox or a project of the list, a project removed or
//! merged takes its notes first, a note's copy names its images as the project's machine does, an
//! export never writes in a project's folder (`docs/features/notes.md`).

use std::path::{Path, PathBuf};

use super::machines::Start;
use super::projects::Projects;
use crate::modules::notes::{
    image_file, to_markdown, Book, ExportWords, NotesStorage, NotesStore, EXPORT_IMAGES, INBOX_BOOK,
};
use crate::modules::projects::{Location, Project, ProjectList};
use crate::shared::error::{user_facing, UserFacingErrorCode};

/// Where an export writes: files of this host, each written whole.
pub trait ExportFiles: Send + Sync {
    fn write_whole(&self, path: &Path, bytes: &[u8]) -> anyhow::Result<()>;
}

/// A project's book.
pub fn project_book(project: &Project) -> Book {
    Book::Project {
        id: project.id.clone(),
        name: project.name.clone(),
    }
}

/// What the dialog of an export needs: the project's name, and whether the notes have images, so
/// the export is a folder.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ExportTarget {
    pub name: String,
    pub folder: bool,
}

/// The notes of the list's books: the projects, the notes and where they are stored.
pub struct Notes<'a> {
    projects: &'a Projects,
    store: &'a NotesStore,
    storage: &'a dyn NotesStorage,
}

impl<'a> Notes<'a> {
    pub fn new(
        projects: &'a Projects,
        store: &'a NotesStore,
        storage: &'a dyn NotesStorage,
    ) -> Self {
        Self {
            projects,
            store,
            storage,
        }
    }

    /// The book a client names: the Inbox, or a project of the list. Any other id is refused.
    pub fn book(&self, id: &str) -> anyhow::Result<Book> {
        if id == INBOX_BOOK {
            return Ok(Book::Inbox);
        }
        Ok(project_book(&self.projects.project(id)?))
    }

    /// Forgets a project and deletes its notes; its folder is left as it is. The notes go first:
    /// if they cannot, the project stays, so nothing is left on disk without it. A list that
    /// cannot be stored then fails the removal, the project left without notes.
    pub fn remove_project(&self, id: &str) -> anyhow::Result<ProjectList> {
        let project = self.projects.project(id)?;
        self.store
            .delete_book(self.storage, &project_book(&project))?;
        self.projects
            .update(|list, _| list.remove(id))
            .map(|((), list)| list)
    }

    /// Merges the project `from` into `into`: its folders follow `into`'s, its lists of notes move
    /// into it (one whose name is taken named after `from`), and `from` goes. The notes go first,
    /// once the folders are known to merge: if they cannot, nothing else changes.
    pub fn merge_projects(&self, into: &str, from: &str) -> anyhow::Result<ProjectList> {
        let (target, merged) = (self.projects.project(into)?, self.projects.project(from)?);
        // before any note moves: folders on two machines or one inside another
        self.projects
            .list()
            .check_merge(into, from, self.projects.name_case())?;
        self.store.merge_book(
            self.storage,
            &project_book(&merged),
            &project_book(&target),
            &merged.name,
        )?;
        self.projects
            .update(|list, case| list.merge(into, from, case))
            .map(|((), list)| list)
    }

    /// What a note's copy puts on the clipboard: its text, then where each image is, a line each,
    /// as the project's agents name it: as its machine names the notes' files (in a WSL distro,
    /// its own path). May start that machine (`docs/features/wsl.md`).
    pub fn copy(&self, book: &str, id: &str) -> anyhow::Result<String> {
        let book = self.book(book)?;
        let (text, images) = self.store.note_copy(self.storage, &book, id)?;
        let images = match self.place_of(&book)? {
            Some(place) => images
                .iter()
                .map(|image| {
                    self.projects
                        .host_path(&place, Path::new(image), Start::May)
                })
                .collect::<anyhow::Result<_>>()?,
            None => images,
        };
        Ok(copy_text(&text, &images))
    }

    /// Where a book's project's folders are: its first's place, all of them on one machine. None
    /// for the Inbox and a project without folder.
    fn place_of(&self, book: &Book) -> anyhow::Result<Option<Location>> {
        let Book::Project { id, .. } = book else {
            return Ok(None);
        };
        let project = self.projects.project(id)?;
        Ok(project
            .folders
            .into_iter()
            .next()
            .map(|folder| folder.location))
    }

    /// What the dialog of a project's export needs.
    pub fn export_target(&self, project_id: &str) -> anyhow::Result<ExportTarget> {
        let project = self.projects.project(project_id)?;
        Ok(ExportTarget {
            folder: !self.images(&project_book(&project))?.is_empty(),
            name: project.name,
        })
    }

    /// Writes a project's notes as Markdown at `path`, chosen by the user: with images, a folder,
    /// the Markdown file named after it, the images in `images/` inside it. Never inside a
    /// project's folder: Sidekyk writes in none (`export_in_repository`). What is written is
    /// checked, not only the path chosen: an `images/` already there may link into a project's.
    pub fn export(
        &self,
        project_id: &str,
        path: &Path,
        words: &ExportWords,
        files: &dyn ExportFiles,
    ) -> anyhow::Result<()> {
        let project = self.projects.project(project_id)?;
        let book = project_book(&project);
        let images = self.images(&book)?;
        let (markdown_file, images_folder) = export_paths(path, &project.name, !images.is_empty());
        let mut targets = std::iter::once(&markdown_file).chain(&images_folder);
        if targets.any(|target| self.projects.holds_host_path(target)) {
            return Err(user_facing(UserFacingErrorCode::ExportInRepository));
        }
        let markdown = self.store.with_notes(self.storage, &book, |lists, notes| {
            to_markdown(&project.name, lists, notes, words)
        })?;
        files.write_whole(&markdown_file, markdown.as_bytes())?;
        match images_folder {
            Some(folder) => self.export_images(&book, &images, &folder, files),
            None => Ok(()),
        }
    }

    /// Writes `images` of `book` in `folder`, one at a time: an export holds one image in memory
    /// at most. One gone from the notes' folder fails it, rather than leave a link to nothing.
    fn export_images(
        &self,
        book: &Book,
        images: &[String],
        folder: &Path,
        files: &dyn ExportFiles,
    ) -> anyhow::Result<()> {
        for image in images {
            let Some((_, bytes)) = self.store.image(self.storage, book, image)? else {
                anyhow::bail!("the image {image} of a note is missing");
            };
            files.write_whole(&folder.join(image), &bytes)?;
        }
        Ok(())
    }

    /// The files of a book's images, every note's.
    fn images(&self, book: &Book) -> anyhow::Result<Vec<String>> {
        self.store.with_notes(self.storage, book, |_, notes| {
            notes
                .iter()
                .flat_map(|note| note.images.iter().map(image_file))
                .collect()
        })
    }
}

/// Where an export at `path` writes its Markdown file, and its images' folder if it has images:
/// with images `path` is a folder, the name chosen naming the Markdown file in it too.
fn export_paths(path: &Path, project_name: &str, with_images: bool) -> (PathBuf, Option<PathBuf>) {
    if !with_images {
        return (path.to_path_buf(), None);
    }
    let name = path.file_name().map_or_else(
        || project_name.to_string(),
        |name| name.to_string_lossy().into_owned(),
    );
    (
        path.join(format!("{name}.md")),
        Some(path.join(EXPORT_IMAGES)),
    )
}

/// A note's text, then its images' paths, a line each; without images, the text as it is.
fn copy_text(text: &str, images: &[String]) -> String {
    if images.is_empty() {
        return text.to_string();
    }
    let paths = images.join("\n");
    match text.trim_end() {
        "" => paths,
        text => format!("{text}\n\n{paths}"),
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use super::*;
    use crate::app::fake::{Kept, Shelf, Told};
    use crate::app::projects::tests::{projects, shop};
    use crate::modules::notes::{ImageKind, ImageTarget, PreparedImage};
    use crate::modules::projects::AvatarColor;
    use crate::shared::error::{user_facing_code, UserFacingErrorCode};
    use crate::shared::sync::lock;

    /// Files an export wrote, by path.
    #[derive(Default)]
    struct Written(Mutex<Vec<PathBuf>>);

    impl ExportFiles for Written {
        fn write_whole(&self, path: &Path, _: &[u8]) -> anyhow::Result<()> {
            lock(&self.0).push(path.to_path_buf());
            Ok(())
        }
    }

    const WORDS: ExportWords = ExportWords {
        notes: "notes",
        no_notes: "none",
        done: "done",
    };

    /// The shop's project, with a note, and where the list is stored.
    fn shop_with_a_note(store: &NotesStore, shelf: &Shelf) -> (Projects, Project, Arc<Kept>) {
        let shop = shop();
        let list = ProjectList {
            projects: vec![shop.clone()],
            ..ProjectList::default()
        };
        let (projects, storage) = projects(list, &Arc::new(Told::default()));
        let book = project_book(&shop);
        let open = store.notes(shelf, &book).unwrap().open_list;
        store
            .add_note(shelf, &book, &open, "try it".into())
            .unwrap();
        (projects, shop, storage)
    }

    #[test]
    fn a_project_whose_notes_cannot_be_deleted_stays() {
        let (store, shelf) = (NotesStore::default(), Shelf::default());
        let (projects, shop, _) = shop_with_a_note(&store, &shelf);
        let notes = Notes::new(&projects, &store, &shelf);
        *lock(&shelf.refuse_removal) = true;
        assert!(notes.remove_project(&shop.id).is_err());
        assert!(projects.project(&shop.id).is_ok());

        *lock(&shelf.refuse_removal) = false;
        assert!(notes.remove_project(&shop.id).unwrap().projects.is_empty());
    }

    #[test]
    fn a_removal_whose_list_cannot_be_stored_fails() {
        let (store, shelf) = (NotesStore::default(), Shelf::default());
        let (projects, shop, storage) = shop_with_a_note(&store, &shelf);
        let notes = Notes::new(&projects, &store, &shelf);
        *lock(&storage.refuse) = true;
        assert!(notes.remove_project(&shop.id).is_err());
        // as the next start finds it
        assert!(projects.project(&shop.id).is_ok());
    }

    #[test]
    fn an_export_is_never_written_in_a_projects_folder() {
        let (store, shelf) = (NotesStore::default(), Shelf::default());
        let (projects, shop, _) = shop_with_a_note(&store, &shelf);
        let notes = Notes::new(&projects, &store, &shelf);
        let written = Written::default();
        let inside = Path::new("/dev/shop/notes.md");
        let refused = notes
            .export(&shop.id, inside, &WORDS, &written)
            .unwrap_err();
        assert_eq!(
            user_facing_code(&refused),
            Some(UserFacingErrorCode::ExportInRepository)
        );
        assert!(lock(&written.0).is_empty());

        let outside = Path::new("/home/me/shop-notes.md");
        notes.export(&shop.id, outside, &WORDS, &written).unwrap();
        assert_eq!(*lock(&written.0), [outside.to_path_buf()]);
    }

    #[test]
    fn an_export_with_images_is_refused_when_its_images_folder_is_a_projects() {
        let (store, shelf) = (NotesStore::default(), Shelf::default());
        let (projects, shop, _) = shop_with_a_note(&store, &shelf);
        // as an `images/` linking into a project's folder resolves
        let linked = Project::new(
            "linked".into(),
            [Location::Local {
                root: "/home/me/notes/images".into(),
            }],
            AvatarColor::FIRST,
        );
        projects
            .update(|list, _| {
                list.projects.push(linked);
                Ok(())
            })
            .unwrap();
        let book = project_book(&shop);
        let open = store.notes(&shelf, &book).unwrap().open_list;
        let image = PreparedImage {
            kind: ImageKind::Png,
            width: 1,
            height: 1,
            original: vec![1],
            thumb: vec![1],
        };
        store
            .add_images(&shelf, &book, ImageTarget::New { list: open }, vec![image])
            .unwrap();
        let notes = Notes::new(&projects, &store, &shelf);
        let written = Written::default();
        let refused = notes
            .export(&shop.id, Path::new("/home/me/notes"), &WORDS, &written)
            .unwrap_err();
        assert_eq!(
            user_facing_code(&refused),
            Some(UserFacingErrorCode::ExportInRepository)
        );
        assert!(lock(&written.0).is_empty());
    }

    #[test]
    fn an_export_whose_image_is_gone_fails() {
        let (store, shelf) = (NotesStore::default(), Shelf::default());
        let (projects, shop, _) = shop_with_a_note(&store, &shelf);
        let book = project_book(&shop);
        let open = store.notes(&shelf, &book).unwrap().open_list;
        let image = PreparedImage {
            kind: ImageKind::Png,
            width: 1,
            height: 1,
            original: vec![1],
            thumb: vec![1],
        };
        store
            .add_images(&shelf, &book, ImageTarget::New { list: open }, vec![image])
            .unwrap();
        // the image's files deleted by hand from the notes' folder
        let folders = shelf.folders().unwrap();
        let pngs = folders.iter().flat_map(|folder| {
            let files = shelf.files(folder).unwrap();
            files.into_iter().map(move |file| (folder, file))
        });
        for (folder, file) in pngs.filter(|(_, file)| file.ends_with(".png")) {
            shelf.remove(folder, &file).unwrap();
        }
        let notes = Notes::new(&projects, &store, &shelf);
        let written = Written::default();
        let failed = notes
            .export(&shop.id, Path::new("/home/me/notes"), &WORDS, &written)
            .unwrap_err();
        assert!(format!("{failed:#}").contains("is missing"), "{failed:#}");
    }

    #[test]
    fn a_copy_is_the_text_then_a_line_per_image() {
        let images = ["/n/a.png".to_string(), "/n/b.jpg".to_string()];
        assert_eq!(copy_text("look\n", &images), "look\n\n/n/a.png\n/n/b.jpg");
        assert_eq!(copy_text("  \n", &images[..1]), "/n/a.png");
        assert_eq!(copy_text("only text\n", &[]), "only text\n");
    }
}
