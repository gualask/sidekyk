//! The store's lists: added, renamed, deleted, opened, and moved to another book.

use super::{project_only, NotesStore};
use crate::modules::notes::book::NoteBook;
use crate::modules::notes::contracts::{
    Book, DeletedList, MovedList, Note, NoteList, ProjectNotes,
};
use crate::modules::notes::ports::NotesStorage;
use crate::shared::id::new_id;

/// A new id no list of `book` has.
pub(super) fn new_list_id(book: &NoteBook) -> String {
    let mut id = new_id();
    while book.lists.iter().any(|l| l.id == id) {
        id = new_id();
    }
    id
}

impl NotesStore {
    /// Moves a list with its notes to another project: into its list of the same name, else
    /// added last. What comes back undoes it.
    pub fn move_list(
        &self,
        storage: &dyn NotesStorage,
        from: &Book,
        list: &str,
        to: &Book,
    ) -> anyhow::Result<MovedList> {
        project_only(from, "lists")?;
        project_only(to, "lists")?;
        self.exchange(storage, from, to, |giving, taking| {
            let (left, gave) = giving.delete_list(list)?;
            let (into, joined, took) =
                taking.absorb(&left.list, left.notes.clone(), new_list_id(taking))?;
            let moved = MovedList {
                from: from.key().into(),
                to: to.key().into(),
                left,
                into,
                joined,
            };
            Ok((moved, gave, took))
        })
    }

    /// Moves every list of `from` with its notes into `into`, after its own lists, then deletes
    /// `from`: a project merged into another. A list whose name `into` has takes `from`'s label
    /// after it ("Notes (web)"), so no list mixes unseen; a list without notes stays behind.
    pub fn merge_book(
        &self,
        storage: &dyn NotesStorage,
        from: &Book,
        into: &Book,
        label: &str,
    ) -> anyhow::Result<()> {
        project_only(from, "lists")?;
        project_only(into, "lists")?;
        self.exchange(storage, from, into, |giving, taking| {
            let mut took = Vec::new();
            for list in &giving.lists {
                let notes = notes_of(giving, &list.id);
                if notes.is_empty() {
                    continue;
                }
                let named = NoteList {
                    id: list.id.clone(),
                    name: merged_name(&list.name, taking, label),
                };
                let (_, _, touched) = taking.absorb(&named, notes, new_list_id(taking))?;
                took.extend(touched);
            }
            // `from` goes whole below: nothing of it is written again
            Ok(((), Vec::new(), took))
        })?;
        self.delete_book(storage, from)
    }

    /// Brings a moved list back where it was with its notes, and takes them out of the project
    /// they went to, with the list made for them (undo). `from` and `to` are `moved`'s books.
    pub fn unmove_list(
        &self,
        storage: &dyn NotesStorage,
        from: &Book,
        to: &Book,
        moved: MovedList,
    ) -> anyhow::Result<()> {
        project_only(from, "lists")?;
        project_only(to, "lists")?;
        let MovedList {
            left, into, joined, ..
        } = moved;
        let ids: Vec<String> = left.notes.iter().map(|n| n.id.clone()).collect();
        self.exchange(storage, to, from, |giving, taking| {
            let (_, took) = taking.restore_list(left)?;
            Ok(((), giving.unabsorb(&into, joined, &ids), took))
        })
    }

    pub fn add_list(
        &self,
        storage: &dyn NotesStorage,
        book: &Book,
        name: &str,
    ) -> anyhow::Result<NoteList> {
        project_only(book, "lists")?;
        self.change(storage, book, |notes| {
            notes.add_list(new_list_id(notes), name)
        })
    }

    pub fn rename_list(
        &self,
        storage: &dyn NotesStorage,
        book: &Book,
        id: &str,
        name: &str,
    ) -> anyhow::Result<NoteList> {
        project_only(book, "lists")?;
        self.change(storage, book, |notes| notes.rename_list(id, name))
    }

    pub fn delete_list(
        &self,
        storage: &dyn NotesStorage,
        book: &Book,
        id: &str,
    ) -> anyhow::Result<DeletedList> {
        project_only(book, "lists")?;
        self.change(storage, book, |notes| notes.delete_list(id))
    }

    pub fn restore_list(
        &self,
        storage: &dyn NotesStorage,
        book: &Book,
        deleted: DeletedList,
    ) -> anyhow::Result<ProjectNotes> {
        project_only(book, "lists")?;
        self.change(storage, book, |notes| notes.restore_list(deleted))
    }

    pub fn open_list(
        &self,
        storage: &dyn NotesStorage,
        book: &Book,
        id: &str,
    ) -> anyhow::Result<()> {
        project_only(book, "lists")?;
        self.change(storage, book, |notes| Ok(((), notes.open(id)?)))
    }
}

/// Copies of the notes of the list `list` in `book`, in its order.
fn notes_of(book: &NoteBook, list: &str) -> Vec<Note> {
    book.notes
        .iter()
        .filter(|n| n.list == list)
        .cloned()
        .collect()
}

/// The name of a list merged into `taking`: `name`, with `label` after it when `taking` has a
/// list of that name, case ignored.
fn merged_name(name: &str, taking: &NoteBook, label: &str) -> String {
    let lower = name.to_lowercase();
    if taking.lists.iter().any(|l| l.name.to_lowercase() == lower) {
        format!("{name} ({label})")
    } else {
        name.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::super::tests::*;
    use super::*;

    #[test]
    fn a_list_moves_to_another_project_and_back() {
        let storage = MemoryStorage::default();
        let store = NotesStore::default();
        let release = store.add_list(&storage, &shop(), "Release").unwrap();
        let done = store
            .add_note(&storage, &shop(), &release.id, "done".into())
            .unwrap();
        store
            .set_note_done(&storage, &shop(), &done.id, true)
            .unwrap();
        store
            .add_note(&storage, &shop(), &release.id, "open".into())
            .unwrap();
        let before = store.notes(&storage, &shop()).unwrap();

        let moved = store
            .move_list(&storage, &shop(), &release.id, &docs())
            .unwrap();
        assert!(!moved.joined);
        assert_eq!((moved.left.index, moved.left.notes.len()), (1, 2));
        let notes = store.notes(&storage, &docs()).unwrap();
        assert_eq!(notes.lists[1].id, moved.into);
        assert_eq!(notes.lists[1].name, "Release");
        assert_eq!(notes.notes.len(), 2);
        assert_eq!(store.notes(&storage, &shop()).unwrap().lists.len(), 1);

        store
            .unmove_list(&storage, &shop(), &docs(), moved)
            .unwrap();
        let mut after = store.notes(&storage, &shop()).unwrap();
        let mut before = before;
        after.notes.sort_by(|a, b| a.id.cmp(&b.id));
        before.notes.sort_by(|a, b| a.id.cmp(&b.id));
        assert_eq!(after, before);
        let docs_notes = store.notes(&storage, &docs()).unwrap();
        assert_eq!((docs_notes.lists.len(), docs_notes.notes.len()), (1, 0));
    }

    #[test]
    fn a_list_moved_where_one_has_its_name_joins_it_until_undone() {
        let storage = MemoryStorage::default();
        let store = NotesStore::default();
        let release = store.add_list(&storage, &shop(), "Release").unwrap();
        store
            .add_note(&storage, &shop(), &release.id, "moved".into())
            .unwrap();
        let theirs = store.add_list(&storage, &docs(), "release").unwrap();
        store
            .add_note(&storage, &docs(), &theirs.id, "theirs".into())
            .unwrap();

        let moved = store
            .move_list(&storage, &shop(), &release.id, &docs())
            .unwrap();
        assert!(moved.joined);
        assert_eq!(moved.into, theirs.id);
        assert_eq!(
            texts(&store, &storage, &docs(), &theirs.id),
            ["theirs", "moved"]
        );

        store
            .unmove_list(&storage, &shop(), &docs(), moved)
            .unwrap();
        assert_eq!(texts(&store, &storage, &docs(), &theirs.id), ["theirs"]);
        assert_eq!(texts(&store, &storage, &shop(), &release.id), ["moved"]);
    }

    #[test]
    fn a_project_merged_brings_its_lists_named_apart_and_goes() {
        let storage = MemoryStorage::default();
        let store = NotesStore::default();
        let general = store.notes(&storage, &shop()).unwrap().open_list;
        store
            .add_note(&storage, &shop(), &general, "api's".into())
            .unwrap();
        let checkout = store.add_list(&storage, &shop(), "Checkout").unwrap();
        store
            .add_note(&storage, &shop(), &checkout.id, "flow".into())
            .unwrap();
        store.add_list(&storage, &shop(), "Empty").unwrap();
        let theirs = store.notes(&storage, &docs()).unwrap().open_list;
        store
            .add_note(&storage, &docs(), &theirs, "theirs".into())
            .unwrap();

        store.merge_book(&storage, &shop(), &docs(), "web").unwrap();
        let merged = store.notes(&storage, &docs()).unwrap();
        let names: Vec<&str> = merged.lists.iter().map(|l| l.name.as_str()).collect();
        let first = &merged.lists[0].name;
        assert_eq!(
            names,
            [first.as_str(), &format!("{first} (web)"), "Checkout"]
        );
        assert_eq!(texts(&store, &storage, &docs(), &theirs), ["theirs"]);
        assert_eq!(
            texts(&store, &storage, &docs(), &merged.lists[1].id),
            ["api's"]
        );
        assert_eq!(
            texts(&store, &storage, &docs(), &merged.lists[2].id),
            ["flow"]
        );
        assert_eq!(store.count(&storage, &shop()).unwrap().open, 0);
    }

    #[test]
    fn the_last_list_of_a_project_does_not_move() {
        let storage = MemoryStorage::default();
        let store = NotesStore::default();
        let general = store.notes(&storage, &shop()).unwrap().open_list;
        assert!(store
            .move_list(&storage, &shop(), &general, &docs())
            .is_err());
    }
}
