//! A book's notes in memory, and every change to them. Pure: each change says which files it
//! touched, and `NotesStore` writes them.

use super::contracts::{DeletedList, ListTarget, Note, NoteList, NotesSummary, ProjectNotes};
use crate::shared::error::{user_facing, UserFacingErrorCode};
use crate::shared::id::is_id;

/// The longest note, in bytes of UTF-8: a long answer of an agent fits many times over.
pub const MAX_NOTE_BYTES: usize = 1024 * 1024;
/// The longest list name, in characters.
const MAX_LIST_NAME: usize = 200;
/// Below this gap between two positions, a note moved between them renumbers its list instead.
const MIN_GAP: f64 = 1e-9;

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

fn missing() -> anyhow::Error {
    user_facing(UserFacingErrorCode::NoteMissing)
}

fn list_missing() -> anyhow::Error {
    user_facing(UserFacingErrorCode::NoteListMissing)
}

fn checked_text(text: &str) -> anyhow::Result<()> {
    if text.len() > MAX_NOTE_BYTES {
        return Err(user_facing(UserFacingErrorCode::NoteTooLong));
    }
    Ok(())
}

fn checked_name(name: &str) -> anyhow::Result<String> {
    let name: String = name.trim().chars().take(MAX_LIST_NAME).collect();
    anyhow::ensure!(!name.is_empty(), "a list needs a name");
    Ok(name)
}

/// A note's first line, as a row shows it, is cut past this many characters.
const TITLE_CHARS: usize = 160;

/// A note's first line that is not blank, cut to fit a row: what names it (the palette, a
/// project's card).
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
fn checked_id(id: &str) -> anyhow::Result<()> {
    anyhow::ensure!(is_id(id), "not a note id: {id:?}");
    Ok(())
}

/// A note handed back by the frontend or another book, before it is stored.
fn checked_note(note: &Note) -> anyhow::Result<()> {
    checked_id(&note.id)?;
    checked_text(&note.text)?;
    anyhow::ensure!(note.position.is_finite(), "a position must be a number");
    Ok(())
}

impl NoteBook {
    /// A book's notes as read, made consistent: at least one list (a new one, `first_list`,
    /// when none was read), every note in a list that exists (else in the first), an open list
    /// that exists. What it had to mend is touched, so the next write stores it.
    pub(super) fn mended(
        mut lists: Vec<NoteList>,
        mut notes: Vec<Note>,
        open_list: Option<String>,
        first_list: impl FnOnce() -> NoteList,
    ) -> (Self, Vec<Touched>) {
        let mut touched = Vec::new();
        let mut seen = std::collections::HashSet::new();
        lists.retain(|l| is_id(&l.id) && seen.insert(l.id.clone()));
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

    /// What a project's card tells of its notes: how many wait, how many are done, and when the
    /// last was written.
    pub(super) fn summary(&self) -> NotesSummary {
        let open = self.notes.iter().filter(|n| n.done.is_none()).count() as u32;
        NotesSummary {
            open,
            done: self.notes.len() as u32 - open,
            last_edited: self.notes.iter().map(|n| n.edited).max(),
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
    fn replace(&mut self, note: Note) -> Touched {
        self.notes.retain(|n| n.id != note.id);
        let touched = Touched::Note(note.id.clone());
        self.notes.push(note);
        touched
    }

    /// Takes a list out; when it was open, the first left opens.
    fn remove_list(&mut self, index: usize) -> (NoteList, Vec<Touched>) {
        let list = self.lists.remove(index);
        let mut touched = vec![Touched::Lists];
        if self.open_list == list.id {
            self.open_list = self.lists[0].id.clone();
            touched.push(Touched::State);
        }
        (list, touched)
    }

    fn note_mut(&mut self, id: &str) -> anyhow::Result<&mut Note> {
        self.notes
            .iter_mut()
            .find(|n| n.id == id)
            .ok_or_else(missing)
    }

    fn list_index(&self, id: &str) -> anyhow::Result<usize> {
        self.lists
            .iter()
            .position(|l| l.id == id)
            .ok_or_else(list_missing)
    }

    /// The open notes of a list but `except`, from the top.
    fn open_notes(&self, list: &str, except: &str) -> Vec<&Note> {
        let mut open: Vec<&Note> = self
            .notes
            .iter()
            .filter(|n| n.list == list && n.done.is_none() && n.id != except)
            .collect();
        open.sort_by(|a, b| a.position.total_cmp(&b.position));
        open
    }

    /// A note written in a list, on top of it.
    pub(super) fn add(
        &mut self,
        id: String,
        list: &str,
        text: String,
        now: u64,
    ) -> anyhow::Result<(Note, Vec<Touched>)> {
        checked_text(&text)?;
        self.list_index(list)?;
        let position = self
            .open_notes(list, "")
            .first()
            .map_or(0.0, |top| top.position - 1.0);
        let note = Note {
            id,
            list: list.into(),
            position,
            text,
            created: now,
            edited: now,
            done: None,
        };
        self.notes.push(note.clone());
        let touched = vec![Touched::Note(note.id.clone())];
        Ok((note, touched))
    }

    pub(super) fn set_text(
        &mut self,
        id: &str,
        text: String,
        now: u64,
    ) -> anyhow::Result<(Note, Vec<Touched>)> {
        checked_text(&text)?;
        let note = self.note_mut(id)?;
        if note.text == text {
            return Ok((note.clone(), Vec::new()));
        }
        note.text = text;
        note.edited = now;
        Ok((note.clone(), vec![Touched::Note(id.into())]))
    }

    /// Done, or open again in the place it had.
    pub(super) fn set_done(
        &mut self,
        id: &str,
        done: bool,
        now: u64,
    ) -> anyhow::Result<(Note, Vec<Touched>)> {
        let note = self.note_mut(id)?;
        if note.done.is_some() == done {
            return Ok((note.clone(), Vec::new()));
        }
        note.done = done.then_some(now);
        Ok((note.clone(), vec![Touched::Note(id.into())]))
    }

    /// Moves a note to `index` among the open notes of `list` (another list, or its own). Usually
    /// only the note changes; when there is no room left between its neighbors, the list is
    /// renumbered and every note of it comes back.
    pub(super) fn place(
        &mut self,
        id: &str,
        list: &str,
        index: usize,
    ) -> anyhow::Result<(Vec<Note>, Vec<Touched>)> {
        self.list_index(list)?;
        self.note_mut(id)?;
        let open = self.open_notes(list, id);
        let index = index.min(open.len());
        let before = index.checked_sub(1).map(|i| open[i].position);
        let after = open.get(index).map(|n| n.position);
        let position = match (before, after) {
            (None, None) => Some(0.0),
            (None, Some(after)) => Some(after - 1.0),
            (Some(before), None) => Some(before + 1.0),
            (Some(before), Some(after)) => {
                let middle = before + (after - before) / 2.0;
                (after - before > MIN_GAP && middle > before && middle < after).then_some(middle)
            }
        };
        if let Some(position) = position {
            let note = self.note_mut(id)?;
            note.list = list.into();
            note.position = position;
            let note = note.clone();
            return Ok((vec![note.clone()], vec![Touched::Note(note.id)]));
        }
        let mut order: Vec<String> = open.iter().map(|n| n.id.clone()).collect();
        order.insert(index, id.into());
        let mut changed = Vec::with_capacity(order.len());
        for (place, note_id) in order.iter().enumerate() {
            let note = self.note_mut(note_id)?;
            note.list = list.into();
            note.position = place as f64;
            changed.push(note.clone());
        }
        let touched = order.into_iter().map(Touched::Note).collect();
        Ok((changed, touched))
    }

    /// Puts a note back as it was given, in place of the one with its id if any (undo).
    pub(super) fn restore(&mut self, note: Note) -> anyhow::Result<(Note, Vec<Touched>)> {
        checked_note(&note)?;
        self.list_index(&note.list)?;
        let touched = vec![self.replace(note.clone())];
        Ok((note, touched))
    }

    pub(super) fn delete(&mut self, id: &str) -> anyhow::Result<Vec<Touched>> {
        let touched = self.take_out(id);
        if touched.is_empty() {
            return Err(missing());
        }
        Ok(touched)
    }

    /// A new list, last, and open.
    pub(super) fn add_list(
        &mut self,
        id: String,
        name: &str,
    ) -> anyhow::Result<(NoteList, Vec<Touched>)> {
        let list = self.push_list(id, name)?;
        self.open_list = list.id.clone();
        Ok((list, vec![Touched::Lists, Touched::State]))
    }

    /// A new list, last; the open one stays.
    fn push_list(&mut self, id: String, name: &str) -> anyhow::Result<NoteList> {
        let list = NoteList {
            id,
            name: checked_name(name)?,
        };
        self.lists.push(list.clone());
        Ok(list)
    }

    /// The list a moved note goes to, made when asked for (`new_id` its id).
    fn target_list(
        &mut self,
        target: ListTarget,
        new_id: String,
    ) -> anyhow::Result<(String, Vec<Touched>)> {
        match target {
            ListTarget::Open => Ok((self.open_list.clone(), Vec::new())),
            ListTarget::List { id } => {
                self.list_index(&id)?;
                Ok((id, Vec::new()))
            }
            ListTarget::New { name } => {
                let list = self.push_list(new_id, &name)?;
                Ok((list.id, vec![Touched::Lists]))
            }
        }
    }

    /// Takes in a note moved from another book, or from another list of this one, with its id: on
    /// top of the open notes of the list `target` names (`new_list` the id of one made for it).
    /// Done, it stays done unless `reopen`.
    pub(super) fn receive(
        &mut self,
        note: Note,
        target: ListTarget,
        new_list: String,
        reopen: bool,
    ) -> anyhow::Result<(Note, Vec<Touched>)> {
        checked_note(&note)?;
        let (list, mut touched) = self.target_list(target, new_list)?;
        let position = self
            .open_notes(&list, &note.id)
            .first()
            .map_or(0.0, |top| top.position - 1.0);
        let note = Note {
            list,
            position,
            done: if reopen { None } else { note.done },
            ..note
        };
        touched.push(self.replace(note.clone()));
        Ok((note, touched))
    }

    /// Takes a note out, if it is still there.
    pub(super) fn take_out(&mut self, id: &str) -> Vec<Touched> {
        let before = self.notes.len();
        self.notes.retain(|n| n.id != id);
        if self.notes.len() == before {
            return Vec::new();
        }
        vec![Touched::Note(id.into())]
    }

    /// Takes in a list of another book with its notes: into the list of the same name (case
    /// aside), its open notes below that list's in their order, its done ones kept; else as a
    /// new list, last, of id `new_id`. The list that took them, and whether it was there.
    pub(super) fn absorb(
        &mut self,
        list: &NoteList,
        notes: Vec<Note>,
        new_id: String,
    ) -> anyhow::Result<(String, bool, Vec<Touched>)> {
        for note in &notes {
            checked_note(note)?;
        }
        let name = list.name.to_lowercase();
        let (into, joined, mut touched) =
            match self.lists.iter().find(|l| l.name.to_lowercase() == name) {
                Some(own) => (own.id.clone(), true, Vec::new()),
                None => (
                    self.push_list(new_id, &list.name)?.id,
                    false,
                    vec![Touched::Lists],
                ),
            };
        let mut bottom = self
            .open_notes(&into, "")
            .last()
            .map_or(-1.0, |n| n.position);
        let mut notes = notes;
        notes.sort_by(|a, b| a.position.total_cmp(&b.position));
        for note in notes {
            let position = if note.done.is_none() {
                bottom += 1.0;
                bottom
            } else {
                note.position
            };
            touched.push(self.replace(Note {
                list: into.clone(),
                position,
                ..note
            }));
        }
        Ok((into, joined, touched))
    }

    /// Gives back what `absorb` took in (undo): the notes of `ids`, and the list `into` when it
    /// was made for them and holds no other note.
    pub(super) fn unabsorb(&mut self, into: &str, joined: bool, ids: &[String]) -> Vec<Touched> {
        let mut touched: Vec<Touched> = ids.iter().flat_map(|id| self.take_out(id)).collect();
        let kept = joined || self.lists.len() < 2 || self.notes.iter().any(|n| n.list == into);
        if !kept {
            if let Ok(index) = self.list_index(into) {
                touched.extend(self.remove_list(index).1);
            }
        }
        touched
    }

    pub(super) fn rename_list(
        &mut self,
        id: &str,
        name: &str,
    ) -> anyhow::Result<(NoteList, Vec<Touched>)> {
        let name = checked_name(name)?;
        let index = self.list_index(id)?;
        self.lists[index].name = name;
        Ok((self.lists[index].clone(), vec![Touched::Lists]))
    }

    /// Deletes a list and its notes; the last list stays. When it was open, the first list left
    /// opens.
    pub(super) fn delete_list(&mut self, id: &str) -> anyhow::Result<(DeletedList, Vec<Touched>)> {
        let index = self.list_index(id)?;
        anyhow::ensure!(self.lists.len() > 1, "a project keeps one list at least");
        let (list, mut touched) = self.remove_list(index);
        let (notes, kept) = std::mem::take(&mut self.notes)
            .into_iter()
            .partition(|n: &Note| n.list == list.id);
        self.notes = kept;
        touched.extend(notes.iter().map(|n| Touched::Note(n.id.clone())));
        let deleted = DeletedList {
            list,
            index: index as u32,
            notes,
        };
        Ok((deleted, touched))
    }

    /// Brings back a deleted list with its notes, where it was, and opens it (undo).
    pub(super) fn restore_list(
        &mut self,
        deleted: DeletedList,
    ) -> anyhow::Result<(ProjectNotes, Vec<Touched>)> {
        let DeletedList { list, index, notes } = deleted;
        checked_id(&list.id)?;
        let list = NoteList {
            name: checked_name(&list.name)?,
            ..list
        };
        anyhow::ensure!(
            !self.lists.iter().any(|l| l.id == list.id),
            "the list is already there"
        );
        for note in &notes {
            checked_note(note)?;
            anyhow::ensure!(note.list == list.id, "a note of another list");
        }
        let index = (index as usize).min(self.lists.len());
        self.open_list = list.id.clone();
        self.lists.insert(index, list);
        let mut touched = vec![Touched::Lists, Touched::State];
        for note in notes {
            touched.push(self.replace(note));
        }
        Ok((self.snapshot(), touched))
    }

    pub(super) fn open(&mut self, id: &str) -> anyhow::Result<Vec<Touched>> {
        self.list_index(id)?;
        if self.open_list == id {
            return Ok(Vec::new());
        }
        self.open_list = id.into();
        Ok(vec![Touched::State])
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::shared::error::user_facing_code;

    const GENERAL: &str = "1000000000000000";
    const RELEASE: &str = "2000000000000000";

    fn id(n: u32) -> String {
        format!("{n:016x}")
    }

    fn book() -> NoteBook {
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
    fn order(book: &NoteBook, list: &str) -> Vec<String> {
        book.open_notes(list, "")
            .into_iter()
            .map(|n| n.text.clone())
            .collect()
    }

    fn with_notes(texts: &[&str]) -> NoteBook {
        let mut book = book();
        // added bottom first, so they read top to bottom as given
        for (n, text) in texts.iter().rev().enumerate() {
            book.add(id(n as u32 + 1), GENERAL, (*text).into(), 1)
                .unwrap();
        }
        book
    }

    fn id_of(book: &NoteBook, text: &str) -> String {
        book.notes
            .iter()
            .find(|n| n.text == text)
            .unwrap()
            .id
            .clone()
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
    fn a_new_note_goes_on_top() {
        let book = with_notes(&["b", "c"]);
        let mut book = book;
        book.add(id(9), GENERAL, "a".into(), 5).unwrap();
        assert_eq!(order(&book, GENERAL), ["a", "b", "c"]);
    }

    #[test]
    fn a_note_moves_between_two_others_alone() {
        let mut book = with_notes(&["a", "b", "c", "d"]);
        let d = id_of(&book, "d");
        let (changed, touched) = book.place(&d, GENERAL, 1).unwrap();
        assert_eq!(order(&book, GENERAL), ["a", "d", "b", "c"]);
        assert_eq!(changed.len(), 1);
        assert_eq!(touched, vec![Touched::Note(d)]);

        let a = id_of(&book, "a");
        book.place(&a, GENERAL, 99).unwrap();
        assert_eq!(order(&book, GENERAL), ["d", "b", "c", "a"]);
        book.place(&a, GENERAL, 0).unwrap();
        assert_eq!(order(&book, GENERAL), ["a", "d", "b", "c"]);
    }

    #[test]
    fn without_room_between_two_notes_the_list_is_renumbered() {
        let mut book = with_notes(&["a", "b", "c"]);
        let (a, b) = (id_of(&book, "a"), id_of(&book, "b"));
        book.note_mut(&a).unwrap().position = 1.0;
        book.note_mut(&b).unwrap().position = 1.0 + 1e-12;
        book.note_mut(&id_of(&book, "c")).unwrap().position = 2.0;
        let (changed, touched) = book.place(&id_of(&book, "c"), GENERAL, 1).unwrap();
        assert_eq!(order(&book, GENERAL), ["a", "c", "b"]);
        assert_eq!(changed.len(), 3);
        assert_eq!(touched.len(), 3);
        let positions: Vec<f64> = book
            .open_notes(GENERAL, "")
            .iter()
            .map(|n| n.position)
            .collect();
        assert_eq!(positions, [0.0, 1.0, 2.0]);
    }

    #[test]
    fn a_note_moved_to_another_list_lands_where_asked() {
        let mut book = with_notes(&["a", "b"]);
        book.add(id(9), RELEASE, "r".into(), 1).unwrap();
        let b = id_of(&book, "b");
        book.place(&b, RELEASE, 0).unwrap();
        assert_eq!(order(&book, GENERAL), ["a"]);
        assert_eq!(order(&book, RELEASE), ["b", "r"]);
    }

    #[test]
    fn done_notes_leave_the_order_and_come_back_to_their_place() {
        let mut book = with_notes(&["a", "b", "c"]);
        let b = id_of(&book, "b");
        let (note, _) = book.set_done(&b, true, 7).unwrap();
        assert_eq!(note.done, Some(7));
        assert_eq!(order(&book, GENERAL), ["a", "c"]);
        // done twice keeps the first time
        assert_eq!(book.set_done(&b, true, 9).unwrap().0.done, Some(7));
        book.set_done(&b, false, 9).unwrap();
        assert_eq!(order(&book, GENERAL), ["a", "b", "c"]);
    }

    #[test]
    fn editing_the_same_text_keeps_the_time_it_was_edited() {
        let mut book = with_notes(&["a"]);
        let a = id_of(&book, "a");
        assert_eq!(book.set_text(&a, "a".into(), 5).unwrap().0.edited, 1);
        assert_eq!(book.set_text(&a, "b".into(), 5).unwrap().0.edited, 5);
    }

    #[test]
    fn a_note_too_long_is_refused() {
        let mut book = with_notes(&["a"]);
        let long = "x".repeat(MAX_NOTE_BYTES + 1);
        let error = book.add(id(9), GENERAL, long.clone(), 1).unwrap_err();
        assert_eq!(
            user_facing_code(&error),
            Some(UserFacingErrorCode::NoteTooLong)
        );
        assert!(book.set_text(&id_of(&book, "a"), long, 1).is_err());
    }

    #[test]
    fn a_missing_note_or_list_is_named_as_such() {
        let mut book = book();
        for error in [
            book.set_text("gone", "x".into(), 1).unwrap_err(),
            book.delete("gone").unwrap_err(),
        ] {
            assert_eq!(
                user_facing_code(&error),
                Some(UserFacingErrorCode::NoteMissing)
            );
        }
        let error = book.add(id(1), "gone", "x".into(), 1).unwrap_err();
        assert_eq!(
            user_facing_code(&error),
            Some(UserFacingErrorCode::NoteListMissing)
        );
    }

    #[test]
    fn a_change_that_changes_nothing_writes_nothing() {
        let mut book = with_notes(&["a"]);
        let a = id_of(&book, "a");
        assert!(book.set_text(&a, "a".into(), 5).unwrap().1.is_empty());
        assert!(book.set_done(&a, false, 5).unwrap().1.is_empty());
    }

    #[test]
    fn a_deleted_note_comes_back_as_it_was() {
        let mut book = with_notes(&["a", "b"]);
        let a = book.note(&id_of(&book, "a")).unwrap().clone();
        book.delete(&a.id).unwrap();
        assert_eq!(order(&book, GENERAL), ["b"]);
        book.restore(a.clone()).unwrap();
        assert_eq!(order(&book, GENERAL), ["a", "b"]);
        // restoring over itself replaces it
        book.restore(a).unwrap();
        assert_eq!(book.notes.len(), 2);
    }

    #[test]
    fn a_note_restored_with_a_foreign_id_is_refused() {
        let mut book = with_notes(&["a"]);
        let mut a = book.notes[0].clone();
        a.id = "../../escape".into();
        assert!(book.restore(a).is_err());
    }

    #[test]
    fn a_deleted_list_takes_its_notes_and_comes_back_with_them() {
        let mut book = with_notes(&["a"]);
        book.add(id(9), RELEASE, "r".into(), 1).unwrap();
        book.open(RELEASE).unwrap();
        let (deleted, touched) = book.delete_list(RELEASE).unwrap();
        assert_eq!(deleted.index, 1);
        assert_eq!(deleted.notes.len(), 1);
        assert_eq!(book.open_list, GENERAL);
        assert!(touched.contains(&Touched::Note(id(9))));
        assert_eq!(book.notes.len(), 1);

        let (restored, _) = book.restore_list(deleted).unwrap();
        assert_eq!(restored.lists[1].id, RELEASE);
        assert_eq!(restored.open_list, RELEASE);
        assert_eq!(order(&book, RELEASE), ["r"]);
    }

    #[test]
    fn the_last_list_stays() {
        let mut book = book();
        book.delete_list(RELEASE).unwrap();
        assert!(book.delete_list(GENERAL).is_err());
    }

    #[test]
    fn a_new_list_goes_last_and_opens() {
        let mut book = book();
        let (list, _) = book.add_list(id(5), "  Architecture  ").unwrap();
        assert_eq!(list.name, "Architecture");
        assert_eq!(book.lists.last(), Some(&list));
        assert_eq!(book.open_list, id(5));
        assert!(book.add_list(id(6), "   ").is_err());
        assert_eq!(book.rename_list(&id(5), "Arch").unwrap().0.name, "Arch");
    }

    #[test]
    fn a_summary_counts_open_and_done_notes_and_tells_the_last_edit() {
        assert_eq!(book().summary(), NotesSummary::default());
        let mut book = with_notes(&["a", "b"]);
        book.add(id(9), RELEASE, "c".into(), 9).unwrap();
        book.set_done(&id_of(&book, "a"), true, 10).unwrap();
        book.set_text(&id_of(&book, "b"), "B".into(), 12).unwrap();
        assert_eq!(
            book.summary(),
            NotesSummary {
                open: 2,
                done: 1,
                last_edited: Some(12)
            }
        );
    }

    #[test]
    fn opening_the_open_list_touches_nothing() {
        let mut book = book();
        assert!(book.open(GENERAL).unwrap().is_empty());
        assert_eq!(book.open(RELEASE).unwrap(), vec![Touched::State]);
    }

    #[test]
    fn a_note_is_named_by_its_first_line_cut_to_fit() {
        let long = "x".repeat(TITLE_CHARS + 10);
        assert_eq!(note_title(&long).chars().count(), TITLE_CHARS + 1);
        assert_eq!(note_title("   \n\n"), "");
        assert_eq!(note_title("\n  Watcher plan \n1."), "Watcher plan");
    }
}
