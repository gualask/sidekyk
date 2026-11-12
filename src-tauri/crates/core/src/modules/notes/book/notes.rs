//! A book's changes to its notes: written, edited, done, moved, restored, deleted, and taken in
//! from another book or given to it.

use super::super::contracts::{ListTarget, Note, NoteImage};
use super::{checked_note, checked_text, missing, NoteBook, Touched};

/// Below this gap between two positions, a note moved between them renumbers its list instead.
const MIN_GAP: f64 = 1e-9;

impl NoteBook {
    /// A note written in a list, on top of it.
    pub(in crate::modules::notes) fn add(
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
            images: Vec::new(),
        };
        self.notes.push(note.clone());
        let touched = vec![Touched::Note(note.id.clone())];
        Ok((note, touched))
    }

    pub(in crate::modules::notes) fn set_text(
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

    /// Images added below a note's, in the order given.
    pub(in crate::modules::notes) fn add_images(
        &mut self,
        id: &str,
        images: Vec<NoteImage>,
        now: u64,
    ) -> anyhow::Result<(Note, Vec<Touched>)> {
        let note = self.note_mut(id)?;
        if images.is_empty() {
            return Ok((note.clone(), Vec::new()));
        }
        note.images.extend(images);
        note.edited = now;
        Ok((note.clone(), vec![Touched::Note(id.into())]))
    }

    /// Takes an image out of a note; its files stay until the book is next read, so an undo
    /// (`restore`) finds them.
    pub(in crate::modules::notes) fn remove_image(
        &mut self,
        id: &str,
        image: &str,
        now: u64,
    ) -> anyhow::Result<(Note, Vec<Touched>)> {
        let note = self.note_mut(id)?;
        let before = note.images.len();
        note.images.retain(|i| i.id != image);
        if note.images.len() == before {
            return Ok((note.clone(), Vec::new()));
        }
        note.edited = now;
        Ok((note.clone(), vec![Touched::Note(id.into())]))
    }

    /// Puts `image` in the place of the note's image `id` was: the same image marked anew, or
    /// given back unmarked. The files of the one it replaces stay until the book is next read.
    pub(in crate::modules::notes) fn replace_image(
        &mut self,
        id: &str,
        replaced: &str,
        image: NoteImage,
        now: u64,
    ) -> anyhow::Result<(Note, Vec<Touched>)> {
        let note = self.note_mut(id)?;
        let place = note
            .images
            .iter_mut()
            .find(|i| i.id == replaced)
            .ok_or_else(|| anyhow::anyhow!("no image {replaced} in note {id}"))?;
        if *place == image {
            return Ok((note.clone(), Vec::new()));
        }
        *place = image;
        note.edited = now;
        Ok((note.clone(), vec![Touched::Note(id.into())]))
    }

    /// Done, or open again in the place it had.
    pub(in crate::modules::notes) fn set_done(
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
    pub(in crate::modules::notes) fn place(
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
        if let Some(position) = position_between(before, after) {
            return self.moved(id, list, position);
        }
        let mut order: Vec<String> = open.iter().map(|n| n.id.clone()).collect();
        order.insert(index, id.into());
        self.renumbered(list, order)
    }

    /// The note of `id` put in `list` at `position`: the only note that changes.
    fn moved(
        &mut self,
        id: &str,
        list: &str,
        position: f64,
    ) -> anyhow::Result<(Vec<Note>, Vec<Touched>)> {
        let note = self.note_mut(id)?;
        note.list = list.into();
        note.position = position;
        let note = note.clone();
        Ok((vec![note.clone()], vec![Touched::Note(note.id)]))
    }

    /// The notes of `order` put in `list`, numbered from 0 in that order.
    fn renumbered(
        &mut self,
        list: &str,
        order: Vec<String>,
    ) -> anyhow::Result<(Vec<Note>, Vec<Touched>)> {
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
    pub(in crate::modules::notes) fn restore(
        &mut self,
        note: Note,
    ) -> anyhow::Result<(Note, Vec<Touched>)> {
        checked_note(&note)?;
        self.list_index(&note.list)?;
        let touched = vec![self.replace(note.clone())];
        Ok((note, touched))
    }

    pub(in crate::modules::notes) fn delete(&mut self, id: &str) -> anyhow::Result<Vec<Touched>> {
        let touched = self.take_out(id);
        if touched.is_empty() {
            return Err(missing());
        }
        Ok(touched)
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
    pub(in crate::modules::notes) fn receive(
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
    pub(in crate::modules::notes) fn take_out(&mut self, id: &str) -> Vec<Touched> {
        let before = self.notes.len();
        self.notes.retain(|n| n.id != id);
        if self.notes.len() == before {
            return Vec::new();
        }
        vec![Touched::Note(id.into())]
    }
}

/// The position between a note's new neighbors (`before` above, `after` below, either absent at
/// an end of the list), or none when no room is left between them.
fn position_between(before: Option<f64>, after: Option<f64>) -> Option<f64> {
    match (before, after) {
        (None, None) => Some(0.0),
        (None, Some(after)) => Some(after - 1.0),
        (Some(before), None) => Some(before + 1.0),
        (Some(before), Some(after)) => {
            let middle = before + (after - before) / 2.0;
            (after - before > MIN_GAP && middle > before && middle < after).then_some(middle)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::super::tests::*;
    use super::super::MAX_NOTE_BYTES;
    use super::*;
    use crate::shared::error::{user_facing_code, UserFacingErrorCode};

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
}
