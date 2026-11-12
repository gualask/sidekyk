//! A book read into the store: its folder found or made, its files read and mended, the images no
//! note has swept the first time.

use std::collections::HashMap;
use std::time::Instant;

use super::{KeptBook, NotesStore, FIRST_LIST_ID, FIRST_LIST_NAME, INBOX_FOLDER};
use crate::modules::notes::book::{NoteBook, Touched};
use crate::modules::notes::contracts::{Book, NoteList, StoredProject, STORED_VERSION};
use crate::modules::notes::files::{
    folder_name, project_folders, read_folder, sweep, write_json, FolderFiles, PROJECT_FILE,
};
use crate::modules::notes::ports::NotesStorage;
use crate::shared::error::{rebuilt, user_facing_code, UserFacingErrorCode};
use crate::shared::sync::lock;

impl NotesStore {
    /// The folder of a book: the Inbox's always, a project's from its `project.json`.
    pub(super) fn folder_of(
        &self,
        storage: &dyn NotesStorage,
        book: &Book,
    ) -> anyhow::Result<Option<String>> {
        let Book::Project { id, .. } = book else {
            return Ok(Some(INBOX_FOLDER.into()));
        };
        let mut folders = lock(&self.folders);
        if folders.is_none() {
            *folders = Some(project_folders(storage)?);
        }
        Ok(folders.as_ref().and_then(|f| f.get(id).cloned()))
    }

    /// A new folder's name for a project: one no project has, nor any file is in.
    pub(super) fn free_folder(
        &self,
        storage: &dyn NotesStorage,
        name: &str,
    ) -> anyhow::Result<String> {
        loop {
            let folder = folder_name(name);
            let taken = lock(&self.folders)
                .as_ref()
                .is_some_and(|found| found.values().any(|f| *f == folder));
            if !taken && storage.files(&folder)?.is_empty() {
                return Ok(folder);
            }
        }
    }

    /// The list a book without lists gets, named in the language of the app.
    fn first_list(&self) -> NoteList {
        let name = lock(&self.first_list_name).unwrap_or(FIRST_LIST_NAME);
        NoteList {
            id: FIRST_LIST_ID.into(),
            name: name.into(),
        }
    }

    /// Removes the image files no note of `book` has, the first time this run reads it.
    fn sweep_once(
        &self,
        storage: &dyn NotesStorage,
        book: &Book,
        folder: &str,
        notes: &NoteBook,
        images: &[String],
    ) {
        if lock(&self.swept).insert(book.key().into()) {
            sweep(storage, folder, &notes.notes, images);
        }
    }

    fn load(&self, storage: &dyn NotesStorage, book: &Book) -> anyhow::Result<KeptBook> {
        let started = Instant::now();
        let folder = self.folder_of(storage, book)?;
        let FolderFiles {
            lists,
            notes,
            open_list,
            images,
        } = match folder.as_deref() {
            Some(folder) => read_folder(storage, folder)?,
            None => FolderFiles::default(),
        };
        let (notes, pending) = NoteBook::mended(lists, notes, open_list, || self.first_list());
        if let Some(folder) = folder.as_deref() {
            self.sweep_once(storage, book, folder, &notes, &images);
        }
        tracing::debug!(
            notes = notes.notes.len(),
            ms = started.elapsed().as_millis() as u64,
            "notes read"
        );
        Ok(KeptBook {
            folder,
            notes,
            pending,
        })
    }

    /// A book's notes from the storage, unless refused this session: a book refused is not read
    /// again.
    pub(super) fn read_book(
        &self,
        storage: &dyn NotesStorage,
        book: &Book,
    ) -> anyhow::Result<KeptBook> {
        if let Some(refusal) = lock(&self.refused).get(book.key()) {
            return Err(rebuilt(Some(UserFacingErrorCode::NotesUnreadable), refusal));
        }
        let error = match self.load(storage, book) {
            Ok(kept) => return Ok(kept),
            Err(error) => error,
        };
        if user_facing_code(&error) == Some(UserFacingErrorCode::NotesUnreadable) {
            tracing::warn!(
                book = book.key(),
                error = %format!("{error:#}"),
                "notes refused: not read again nor written this session"
            );
            lock(&self.refused).insert(book.key().into(), format!("{error:#}"));
        }
        Err(error)
    }

    /// The folder of a book, made with its `project.json` when nothing of it is written yet: the
    /// first list, made in memory, is then written with the next change.
    pub(super) fn folder(
        &self,
        storage: &dyn NotesStorage,
        book: &Book,
        kept: &mut KeptBook,
    ) -> anyhow::Result<String> {
        match (&kept.folder, book) {
            (Some(folder), _) => Ok(folder.clone()),
            (None, Book::Inbox) => unreachable!("the Inbox's folder is known"),
            (None, Book::Project { id, name }) => {
                let folder = self.free_folder(storage, name)?;
                write_json(
                    storage,
                    &folder,
                    PROJECT_FILE,
                    &StoredProject {
                        version: STORED_VERSION,
                        id: id.clone(),
                    },
                )?;
                lock(&self.folders)
                    .get_or_insert_with(HashMap::new)
                    .insert(id.clone(), folder.clone());
                kept.folder = Some(folder.clone());
                kept.pending.push(Touched::Lists);
                Ok(folder)
            }
        }
    }
}
