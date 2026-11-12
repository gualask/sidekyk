//! A book's changes to its lists: added, renamed, deleted, restored, opened, and taken in from
//! another book with their notes.

use super::super::contracts::{DeletedList, Note, NoteList, ProjectNotes};
use super::{checked_id, checked_note, NoteBook, Touched};

/// The longest list name, in characters.
const MAX_LIST_NAME: usize = 200;

fn checked_name(name: &str) -> anyhow::Result<String> {
    let name: String = name.trim().chars().take(MAX_LIST_NAME).collect();
    anyhow::ensure!(!name.is_empty(), "a list needs a name");
    Ok(name)
}

impl NoteBook {
    /// A new list, last, and open.
    pub(in crate::modules::notes) fn add_list(
        &mut self,
        id: String,
        name: &str,
    ) -> anyhow::Result<(NoteList, Vec<Touched>)> {
        let list = self.push_list(id, name)?;
        self.open_list = list.id.clone();
        Ok((list, vec![Touched::Lists, Touched::State]))
    }

    /// A new list, last; the open one stays.
    pub(in crate::modules::notes) fn push_list(
        &mut self,
        id: String,
        name: &str,
    ) -> anyhow::Result<NoteList> {
        let list = NoteList {
            id,
            name: checked_name(name)?,
        };
        self.lists.push(list.clone());
        Ok(list)
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

    /// Takes in a list of another book with its notes: into the list of the same name (case
    /// aside), its open notes below that list's in their order, its done ones kept; else as a
    /// new list, last, of id `new_id`. The list that took them, and whether it was there.
    pub(in crate::modules::notes) fn absorb(
        &mut self,
        list: &NoteList,
        notes: Vec<Note>,
        new_id: String,
    ) -> anyhow::Result<(String, bool, Vec<Touched>)> {
        for note in &notes {
            checked_note(note)?;
        }
        let (into, joined, mut touched) = self.absorbing_list(list, new_id)?;
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

    /// The list that takes in `list`'s notes: this book's of the same name (case aside), else a
    /// new one, last, of id `new_id`; and whether it was there.
    fn absorbing_list(
        &mut self,
        list: &NoteList,
        new_id: String,
    ) -> anyhow::Result<(String, bool, Vec<Touched>)> {
        let name = list.name.to_lowercase();
        match self.lists.iter().find(|l| l.name.to_lowercase() == name) {
            Some(own) => Ok((own.id.clone(), true, Vec::new())),
            None => Ok((
                self.push_list(new_id, &list.name)?.id,
                false,
                vec![Touched::Lists],
            )),
        }
    }

    /// Gives back what `absorb` took in (undo): the notes of `ids`, and the list `into` when it
    /// was made for them and holds no other note.
    pub(in crate::modules::notes) fn unabsorb(
        &mut self,
        into: &str,
        joined: bool,
        ids: &[String],
    ) -> Vec<Touched> {
        let mut touched: Vec<Touched> = ids.iter().flat_map(|id| self.take_out(id)).collect();
        let kept = joined || self.lists.len() < 2 || self.notes.iter().any(|n| n.list == into);
        if !kept {
            if let Ok(index) = self.list_index(into) {
                touched.extend(self.remove_list(index).1);
            }
        }
        touched
    }

    pub(in crate::modules::notes) fn rename_list(
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
    pub(in crate::modules::notes) fn delete_list(
        &mut self,
        id: &str,
    ) -> anyhow::Result<(DeletedList, Vec<Touched>)> {
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
    pub(in crate::modules::notes) fn restore_list(
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

    pub(in crate::modules::notes) fn open(&mut self, id: &str) -> anyhow::Result<Vec<Touched>> {
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
    use super::super::tests::*;
    use super::*;

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
    fn opening_the_open_list_touches_nothing() {
        let mut book = book();
        assert!(book.open(GENERAL).unwrap().is_empty());
        assert_eq!(book.open(RELEASE).unwrap(), vec![Touched::State]);
    }
}
