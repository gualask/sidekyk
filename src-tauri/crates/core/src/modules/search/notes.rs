//! The palette's notes and lists, in the project searched or in every book at all projects:
//! lists by name (fuzzy), notes by the words typed, anywhere in them (fuzzy letters over a whole
//! note would match almost any).

use std::cmp::Reverse;

use super::contracts::{ListMatch, NoteMatch, Snippet};
use super::rank::{Ranker, Texts};
use crate::modules::notes::{note_title as title, Book, BookNotes, Note, NoteList};

/// At most this many notes go back.
pub(super) const NOTE_LIMIT: usize = 50;
/// Around the text found in a note, the characters shown before and after it.
const BEFORE: usize = 24;
const AFTER: usize = 48;
/// The least text looked for inside notes: one letter is in every note.
const MIN_QUERY: usize = 2;

/// The UTF-16 length of some characters, as the frontend counts offsets.
fn utf16(chars: &[char]) -> u32 {
    chars.iter().map(|c| c.len_utf16() as u32).sum()
}

/// The part of `text` around its characters `at..at + len` on one line, `…` where cut, and where
/// they are in that part.
fn snippet(text: &str, at: usize, len: usize) -> Snippet {
    let chars: Vec<char> = text.chars().collect();
    let start = at.saturating_sub(BEFORE);
    let end = (at + len + AFTER).min(chars.len());
    // whitespace, line breaks included, as single spaces; the match's offsets follow
    let mut shown = Vec::new();
    let mut found = [0, 0];
    if start > 0 {
        shown.push('…');
    }
    for (i, &c) in chars.iter().enumerate().take(end).skip(start) {
        if i == at {
            found[0] = utf16(&shown);
        }
        let space = c.is_whitespace();
        if !(space && shown.last().is_some_and(|l: &char| l.is_whitespace())) {
            shown.push(if space { ' ' } else { c });
        }
        if i + 1 == at + len {
            found[1] = utf16(&shown);
        }
    }
    if end < chars.len() {
        shown.push('…');
    }
    Snippet {
        text: shown.into_iter().collect(),
        highlights: vec![found],
    }
}

/// The first run of characters the query matched in a note: where it starts, and how long it is.
fn first_run(matched: &[u32]) -> Option<(usize, usize)> {
    let at = *matched.first()?;
    let len = (at..)
        .zip(matched)
        .take_while(|(want, &got)| *want == got)
        .count();
    Some((at as usize, len))
}

fn note_match(book: &str, note: &Note, lists: &[NoteList], score: u32) -> NoteMatch {
    NoteMatch {
        book: book.into(),
        id: note.id.clone(),
        list: note.list.clone(),
        list_name: lists
            .iter()
            .find(|l| l.id == note.list)
            .map(|l| l.name.clone())
            .unwrap_or_default(),
        title: title(&note.text),
        score,
        highlights: Vec::new(),
        snippet: None,
    }
}

/// The lists of a book whose names match, and the notes holding every word typed, best first,
/// equal ones open before done, in the user's order. A note shows its first line, with the words
/// in it, or else the part around the first word.
pub fn search_notes(
    query: &str,
    book: &str,
    lists: &[NoteList],
    notes: &[Note],
) -> (Vec<ListMatch>, Vec<NoteMatch>) {
    let (lists, notes) = found_in(query, book, lists, notes);
    (lists, notes.into_iter().map(|(note, _)| note).collect())
}

/// The lists and notes of every book that match, best first: the lists of the projects (the
/// Inbox's one is never shown), and the best `NOTE_LIMIT` notes of all. Equal scores: open notes
/// before done ones, then the books' order (the Inbox first, then the projects as their cards),
/// then each book's own.
pub fn search_every_book(query: &str, books: &[BookNotes]) -> (Vec<ListMatch>, Vec<NoteMatch>) {
    let mut lists = Vec::new();
    let mut notes = Vec::new();
    for (place, found) in books.iter().enumerate() {
        let (book_lists, book_notes) = found_in(query, found.book.key(), found.lists, found.notes);
        if !matches!(found.book, Book::Inbox) {
            lists.extend(book_lists);
        }
        // a book's best `NOTE_LIMIT` hold all of its notes among the best of all
        notes.extend(
            book_notes
                .into_iter()
                .enumerate()
                .map(|(rank, (note, done))| (note, done, place, rank)),
        );
    }
    // stable: equal lists keep the books' order
    lists.sort_by_key(|list| Reverse(list.score));
    notes.sort_unstable_by_key(|&(ref note, done, place, rank)| {
        (Reverse(note.score), done, place, rank)
    });
    notes.truncate(NOTE_LIMIT);
    (lists, notes.into_iter().map(|(note, ..)| note).collect())
}

/// `search_notes`, each note with whether it is done.
fn found_in(
    query: &str,
    book: &str,
    lists: &[NoteList],
    notes: &[Note],
) -> (Vec<ListMatch>, Vec<(NoteMatch, bool)>) {
    let mut names = Ranker::new(query, Texts::Names);
    let list_names: Vec<&str> = lists.iter().map(|l| l.name.as_str()).collect();
    let (ranked, _) = names.rank(&list_names, usize::MAX);
    let list_matches = ranked
        .into_iter()
        .map(|r| ListMatch {
            book: book.into(),
            id: lists[r.index].id.clone(),
            name: lists[r.index].name.clone(),
            score: r.score,
            highlights: r.highlights,
        })
        .collect();

    let query = query.trim();
    if query.chars().count() < MIN_QUERY {
        return (list_matches, Vec::new());
    }
    // the user's order: open notes before done ones, list by list, open ones by place within
    // their list (a place means nothing across lists), done ones the last done first
    let mut ordered: Vec<(Option<usize>, &Note)> = notes
        .iter()
        .map(|note| (lists.iter().position(|l| l.id == note.list), note))
        .collect();
    ordered.sort_by(|(list_a, a), (list_b, b)| {
        a.done
            .is_some()
            .cmp(&b.done.is_some())
            .then_with(|| list_a.cmp(list_b))
            .then_with(|| match (a.done, b.done) {
                (Some(x), Some(y)) => y.cmp(&x),
                _ => a.position.total_cmp(&b.position),
            })
    });
    let ordered: Vec<&Note> = ordered.into_iter().map(|(_, note)| note).collect();
    let mut words = Ranker::new(query, Texts::Prose);
    let texts: Vec<&str> = ordered.iter().map(|n| n.text.as_str()).collect();
    let (best, _) = words.best(&texts, NOTE_LIMIT);
    let matches = best
        .into_iter()
        .map(|found| {
            let note = ordered[found.index];
            let mut found = note_match(book, note, lists, found.score);
            if let Some(highlights) = words.highlights(&found.title) {
                found.highlights = highlights;
            } else if let Some((at, len)) = words.matched(&note.text).as_deref().and_then(first_run)
            {
                // every word the part shows, or the first alone
                let mut part = snippet(&note.text, at, len);
                if let Some(highlights) = words.highlights(&part.text) {
                    part.highlights = highlights;
                }
                found.snippet = Some(part);
            }
            (found, note.done.is_some())
        })
        .collect();
    (list_matches, matches)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::notes::{NoteList, INBOX_BOOK};

    fn note(id: &str, position: f64, text: &str, done: Option<u64>) -> Note {
        Note {
            id: id.into(),
            list: "l1".into(),
            position,
            text: text.into(),
            created: 0,
            edited: 0,
            done,
        }
    }

    struct Notes {
        lists: Vec<NoteList>,
        notes: Vec<Note>,
    }

    impl Notes {
        fn search(&self, query: &str) -> (Vec<ListMatch>, Vec<NoteMatch>) {
            search_notes(query, "/dev/shop", &self.lists, &self.notes)
        }
    }

    fn notes_lists() -> Vec<NoteList> {
        vec![
            NoteList {
                id: "l1".into(),
                name: "Architecture".into(),
            },
            NoteList {
                id: "l2".into(),
                name: "Release".into(),
            },
        ]
    }

    fn notes() -> Notes {
        Notes {
            lists: notes_lists(),
            notes: vec![
                note("b", 1.0, "Wide scrollbar setting", None),
                note(
                    "a",
                    0.0,
                    "\n  Watcher plan\n\n1. coalesce events per directory",
                    None,
                ),
                note("d", 2.0, "Old idea about the watcher", Some(5)),
            ],
        }
    }

    #[test]
    fn lists_match_by_name() {
        let (lists, _) = notes().search("rel");
        assert_eq!(lists.len(), 1);
        assert_eq!(lists[0].name, "Release");
        assert_eq!(lists[0].highlights, vec![[0, 3]]);
    }

    #[test]
    fn notes_match_by_the_words_in_their_first_line_or_their_text() {
        let (_, found) = notes().search("watcher");
        let ids: Vec<&str> = found.iter().map(|n| n.id.as_str()).collect();
        // both first lines hold it; the open one first
        assert_eq!(ids, ["a", "d"]);
        assert_eq!(found[0].title, "Watcher plan");
        assert_eq!(found[0].highlights, vec![[0, 7]]);
        assert_eq!(found[0].list_name, "Architecture");

        let (_, found) = notes().search("dir per");
        assert_eq!(found.len(), 1);
        let snippet = found[0].snippet.as_ref().unwrap();
        // cut before, line breaks as spaces, nothing cut after
        assert!(snippet.text.starts_with('…'), "{}", snippet.text);
        assert!(snippet.text.ends_with(" 1. coalesce events per directory"));
        let shown: Vec<u16> = snippet.text.encode_utf16().collect();
        let words: Vec<String> = snippet
            .highlights
            .iter()
            .map(|&[start, end]| String::from_utf16(&shown[start as usize..end as usize]).unwrap())
            .collect();
        assert_eq!(words, ["per", "dir"]);
    }

    #[test]
    fn a_word_without_its_accent_finds_the_part_of_the_note_where_it_is() {
        let mut found = notes();
        found
            .notes
            .push(note("c", 3.0, "Menu\nthe café opens late", None));
        let (_, found) = found.search("cafe");
        let snippet = found[0].snippet.as_ref().unwrap();
        assert_eq!(snippet.text, "Menu the café opens late");
        assert_eq!(snippet.highlights, vec![[9, 13]]);
    }

    #[test]
    fn letters_scattered_over_a_note_do_not_match_it() {
        // s…e…e…d over "Wide scrollbar setting": no word of it
        let (_, found) = notes().search("seed");
        assert!(found.is_empty());
    }

    #[test]
    fn one_letter_is_not_looked_for_inside_notes() {
        let (_, found) = notes().search("q");
        assert!(found.iter().all(|n| n.snippet.is_none()));
    }

    /// The books as the store hands them over.
    fn books<'a>(books: &'a [(Book, &'a Notes)]) -> Vec<BookNotes<'a>> {
        books
            .iter()
            .map(|(book, found)| BookNotes {
                book,
                lists: &found.lists,
                notes: &found.notes,
            })
            .collect()
    }

    fn project(id: &str) -> Book {
        Book::Project {
            id: id.into(),
            name: id.into(),
        }
    }

    #[test]
    fn every_book_is_searched_equal_notes_open_first_in_the_books_order() {
        let same = |notes: Vec<Note>| Notes {
            lists: notes_lists(),
            notes,
        };
        let inbox = same(vec![note("i", 0.0, "Watcher plan", None)]);
        let shop = same(vec![
            note("d", 0.0, "Watcher plan", Some(5)),
            note("a", 1.0, "Watcher plan", None),
        ]);
        let docs = same(vec![note("x", 0.0, "Watcher plan", None)]);
        let all = [
            (Book::Inbox, &inbox),
            (project("shop"), &shop),
            (project("docs"), &docs),
        ];
        let (_, found) = search_every_book("watcher", &books(&all));
        let found: Vec<(&str, &str)> = found
            .iter()
            .map(|n| (n.book.as_str(), n.id.as_str()))
            .collect();
        assert_eq!(
            found,
            [
                (INBOX_BOOK, "i"),
                ("shop", "a"),
                ("docs", "x"),
                ("shop", "d")
            ]
        );
    }

    #[test]
    fn every_book_offers_the_lists_of_projects_not_the_inbox_one() {
        let shop = notes();
        let all = [(Book::Inbox, &shop), (project("shop"), &shop)];
        let (lists, _) = search_every_book("arch", &books(&all));
        let lists: Vec<(&str, &str)> = lists
            .iter()
            .map(|l| (l.book.as_str(), l.name.as_str()))
            .collect();
        assert_eq!(lists, [("shop", "Architecture")]);
    }

    #[test]
    fn every_book_gives_the_best_notes_of_all() {
        let crowded = |prefix: &str| Notes {
            lists: notes_lists(),
            notes: (0..NOTE_LIMIT)
                .map(|i| note(&format!("{prefix}{i}"), i as f64, "a plain note", None))
                .collect(),
        };
        let plain = crowded("p");
        let mut best = crowded("b");
        best.notes[NOTE_LIMIT - 1].text = "note".into();
        let all = [(Book::Inbox, &plain), (project("shop"), &best)];
        let (_, found) = search_every_book("note", &books(&all));
        assert_eq!(found.len(), NOTE_LIMIT);
        // the note that is the word typed alone, last of the last book, comes first
        assert_eq!(found[0].id, format!("b{}", NOTE_LIMIT - 1));
    }

    #[test]
    fn notes_keep_to_their_lists_in_order() {
        let mut found = notes();
        // first in its list, but its list comes second
        found.notes.push(Note {
            list: "l2".into(),
            ..note("r", -9.0, "A watcher release note", None)
        });
        let ids: Vec<String> = found
            .search("watcher")
            .1
            .into_iter()
            .map(|n| n.id)
            .collect();
        assert_eq!(ids, ["a", "r", "d"]);
    }
}
