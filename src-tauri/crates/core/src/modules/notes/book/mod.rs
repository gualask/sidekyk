//! A book's notes in memory, and every change to them. Pure: each change says which files it
//! touched, and `NotesStore` writes them. The changes to notes are in `notes`, to lists in
//! `lists`.

mod lists;
mod notes;

use super::contracts::{Note, NoteList, NotesCount, ProjectNotes};
use crate::shared::error::{user_facing, UserFacingErrorCode};
use crate::shared::id::is_id;

/// The longest note, in bytes of UTF-8: a long answer of an agent fits many times over.
pub const MAX_NOTE_BYTES: usize = 1024 * 1024;

/// A file a change touched.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub(super) enum Touched {
    /// A note to write as it now is, or to remove when it is gone.
    Note(String),
    Lists,
    State,
}

#[derive(Clone, Debug, PartialEq)]
pub(super) struct NoteBook {
    /// In the user's order, never empty.
    pub(super) lists: Vec<NoteList>,
    /// In no particular order.
    pub(super) notes: Vec<Note>,
    pub(super) open_list: String,
}

pub(super) fn missing() -> anyhow::Error {
    user_facing(UserFacingErrorCode::NoteMissing)
}

fn list_missing() -> anyhow::Error {
    user_facing(UserFacingErrorCode::NoteListMissing)
}

pub(super) fn checked_text(text: &str) -> anyhow::Result<()> {
    if text.len() > MAX_NOTE_BYTES {
        return Err(user_facing(UserFacingErrorCode::NoteTooLong));
    }
    Ok(())
}

/// A note's first line, as a row shows it, is cut past this many characters.
const TITLE_CHARS: usize = 160;

/// A note's first line that is not blank, cut to fit a row: what names it in the palette.
pub fn note_title(text: &str) -> String {
    let line = text
        .lines()
        .map(str::trim)
        .find(|l| !l.is_empty())
        .unwrap_or("");
    let mut title: String = line.chars().take(TITLE_CHARS).collect();
    if line.chars().count() > TITLE_CHARS {
        title.push('…');
    }
    title
}

/// An id names a file, so nothing but one the app made is let through.
pub(super) fn checked_id(id: &str) -> anyhow::Result<()> {
    anyhow::ensure!(is_id(id), "not a note id: {id:?}");
    Ok(())
}

/// A note handed back by the frontend or another book, before it is stored: its images' ids
/// name files too.
pub(super) fn checked_note(note: &Note) -> anyhow::Result<()> {
    checked_id(&note.id)?;
    checked_text(&note.text)?;
    anyhow::ensure!(note.position.is_finite(), "a position must be a number");
    let mut seen = std::collections::HashSet::new();
    for image in &note.images {
        checked_id(&image.id)?;
        anyhow::ensure!(seen.insert(&image.id), "an image twice in a note");
    }
    Ok(())
}

impl NoteBook {
    /// A book's notes as read whole, made consistent: at least one list (a new one,
    /// `first_list`, when none is stored), every note in a list that exists (else in the first),
    /// an open list that exists. What it had to mend is touched, so the next write stores it.
    pub(super) fn mended(
        mut lists: Vec<NoteList>,
        mut notes: Vec<Note>,
        open_list: Option<String>,
        first_list: impl FnOnce() -> NoteList,
    ) -> (Self, Vec<Touched>) {
        let mut touched = Vec::new();
        if lists.is_empty() {
            lists.push(first_list());
            touched.push(Touched::Lists);
        }
        for note in &mut notes {
            if !lists.iter().any(|l| l.id == note.list) {
                note.list = lists[0].id.clone();
                touched.push(Touched::Note(note.id.clone()));
            }
        }
        let open_list = open_list
            .filter(|id| lists.iter().any(|l| &l.id == id))
            .unwrap_or_else(|| lists[0].id.clone());
        let book = Self {
            lists,
            notes,
            open_list,
        };
        (book, touched)
    }

    /// How many of its notes are open, how many done.
    pub(super) fn count(&self) -> NotesCount {
        let open = self.notes.iter().filter(|n| n.done.is_none()).count() as u32;
        NotesCount {
            open,
            done: self.notes.len() as u32 - open,
        }
    }

    pub(super) fn snapshot(&self) -> ProjectNotes {
        ProjectNotes {
            lists: self.lists.clone(),
            notes: self.notes.clone(),
            open_list: self.open_list.clone(),
        }
    }

    pub(super) fn note(&self, id: &str) -> Option<&Note> {
        self.notes.iter().find(|n| n.id == id)
    }

    /// The note of `id`, or `note_missing`.
    pub(super) fn find(&self, id: &str) -> anyhow::Result<&Note> {
        self.note(id).ok_or_else(missing)
    }

    /// Puts a note in, in place of the one with its id if any.
    pub(super) fn replace(&mut self, note: Note) -> Touched {
        self.notes.retain(|n| n.id != note.id);
        let touched = Touched::Note(note.id.clone());
        self.notes.push(note);
        touched
    }

    pub(super) fn note_mut(&mut self, id: &str) -> anyhow::Result<&mut Note> {
        self.notes
            .iter_mut()
            .find(|n| n.id == id)
            .ok_or_else(missing)
    }

    pub(super) fn list_index(&self, id: &str) -> anyhow::Result<usize> {
        self.lists
            .iter()
            .position(|l| l.id == id)
            .ok_or_else(list_missing)
    }

    /// The open notes of a list but `except`, from the top.
    pub(super) fn open_notes(&self, list: &str, except: &str) -> Vec<&Note> {
        let mut open: Vec<&Note> = self
            .notes
            .iter()
            .filter(|n| n.list == list && n.done.is_none() && n.id != except)
            .collect();
        open.sort_by(|a, b| a.position.total_cmp(&b.position));
        open
    }
}

#[cfg(test)]
pub(super) mod tests {
    use super::*;

    pub(crate) const GENERAL: &str = "1000000000000000";
    pub(crate) const RELEASE: &str = "2000000000000000";

    pub(crate) fn id(n: u32) -> String {
        format!("{n:016x}")
    }

    pub(crate) fn book() -> NoteBook {
        let lists = vec![
            NoteList {
                id: GENERAL.into(),
                name: "General".into(),
            },
            NoteList {
                id: RELEASE.into(),
                name: "Release".into(),
            },
        ];
        NoteBook::mended(lists, Vec::new(), None, || unreachable!()).0
    }

    /// The texts of a list's open notes, from the top.
    pub(crate) fn order(book: &NoteBook, list: &str) -> Vec<String> {
        book.open_notes(list, "")
            .into_iter()
            .map(|n| n.text.clone())
            .collect()
    }

    pub(crate) fn with_notes(texts: &[&str]) -> NoteBook {
        let mut book = book();
        // added bottom first, so they read top to bottom as given
        for (n, text) in texts.iter().rev().enumerate() {
            book.add(id(n as u32 + 1), GENERAL, (*text).into(), 1)
                .unwrap();
        }
        book
    }

    pub(crate) fn id_of(book: &NoteBook, text: &str) -> String {
        book.notes
            .iter()
            .find(|n| n.text == text)
            .unwrap()
            .id
            .clone()
    }

    #[test]
    fn a_count_tells_open_and_done_notes_apart() {
        assert_eq!(book().count(), NotesCount::default());
        let mut book = with_notes(&["a", "b"]);
        book.add(id(9), RELEASE, "c".into(), 9).unwrap();
        book.set_done(&id_of(&book, "a"), true, 10).unwrap();
        assert_eq!(book.count(), NotesCount { open: 2, done: 1 });
    }

    #[test]
    fn a_project_without_lists_gets_one_and_strays_join_it() {
        let stray = Note {
            id: id(1),
            list: "9999999999999999".into(),
            position: 0.0,
            text: "orphan".into(),
            created: 1,
            edited: 1,
            done: None,
            images: Vec::new(),
        };
        let first = || NoteList {
            id: GENERAL.into(),
            name: "General".into(),
        };
        let (book, touched) = NoteBook::mended(Vec::new(), vec![stray], None, first);
        assert_eq!(book.lists[0].name, "General");
        assert_eq!(book.notes[0].list, GENERAL);
        assert_eq!(book.open_list, GENERAL);
        assert_eq!(touched, vec![Touched::Lists, Touched::Note(id(1))]);
    }

    #[test]
    fn a_list_open_that_is_gone_opens_the_first() {
        let lists = book().lists;
        let (book, touched) =
            NoteBook::mended(lists, Vec::new(), Some("gone".into()), || unreachable!());
        assert_eq!(book.open_list, GENERAL);
        assert!(touched.is_empty());
    }

    #[test]
    fn a_note_is_named_by_its_first_line_cut_to_fit() {
        let long = "x".repeat(TITLE_CHARS + 10);
        assert_eq!(note_title(&long).chars().count(), TITLE_CHARS + 1);
        assert_eq!(note_title("   \n\n"), "");
        assert_eq!(note_title("\n  Watcher plan \n1."), "Watcher plan");
    }
}
