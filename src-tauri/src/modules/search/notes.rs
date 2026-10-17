//! The palette's notes and lists, in the project searched: lists by name, notes by their first
//! line (fuzzy) or, failing that, by the text typed anywhere in them (a plain substring, case
//! ignored: fuzzy letters over a whole note would match almost any).

use super::contracts::{Highlight, ListMatch, NoteMatch, Snippet};
use super::rank::{Ranker, Texts};
use crate::modules::notes::{note_title as title, Note, NoteList};

/// At most this many notes go back.
pub(super) const NOTE_LIMIT: usize = 50;
const BEFORE: usize = 24;
const AFTER: usize = 48;
/// The least text looked for inside notes: one letter is in every note.
const MIN_SUBSTRING: usize = 2;

/// The UTF-16 length of some characters, as the frontend counts offsets.
fn utf16(chars: &[char]) -> u32 {
    chars.iter().map(|c| c.len_utf16() as u32).sum()
}

fn folded(c: char) -> char {
    c.to_lowercase().next().unwrap_or(c)
}

/// Where `query` first is in `text`, case ignored: the part around it on one line, `…` where cut,
/// and where the query is in that part.
fn snippet(text: &str, query: &[char]) -> Option<Snippet> {
    let chars: Vec<char> = text.chars().collect();
    let at = chars
        .windows(query.len())
        .position(|window| window.iter().zip(query).all(|(&a, &b)| folded(a) == b))?;
    let start = at.saturating_sub(BEFORE);
    let end = (at + query.len() + AFTER).min(chars.len());
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
        if i + 1 == at + query.len() {
            found[1] = utf16(&shown);
        }
    }
    if end < chars.len() {
        shown.push('…');
    }
    Some(Snippet {
        text: shown.into_iter().collect(),
        highlights: vec![found],
    })
}

fn note_match(note: &Note, lists: &[NoteList], highlights: Vec<Highlight>) -> NoteMatch {
    NoteMatch {
        id: note.id.clone(),
        list: note.list.clone(),
        list_name: lists
            .iter()
            .find(|l| l.id == note.list)
            .map(|l| l.name.clone())
            .unwrap_or_default(),
        title: title(&note.text),
        highlights,
        snippet: None,
        done: note.done.is_some(),
    }
}

/// The lists whose names match, and the notes found, best first: first lines that match, then
/// notes holding the text typed, open before done, in the user's order.
pub(crate) fn search_notes(
    query: &str,
    lists: &[NoteList],
    notes: &[Note],
) -> (Vec<ListMatch>, Vec<NoteMatch>) {
    let mut names = Ranker::new(query, Texts::Names);
    let list_names: Vec<&str> = lists.iter().map(|l| l.name.as_str()).collect();
    let (ranked, _) = names.rank(&list_names, usize::MAX);
    let list_matches = ranked
        .into_iter()
        .map(|r| ListMatch {
            id: lists[r.index].id.clone(),
            name: lists[r.index].name.clone(),
            highlights: r.highlights,
        })
        .collect();

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
    let titles: Vec<String> = ordered.iter().map(|n| title(&n.text)).collect();
    let title_refs: Vec<&str> = titles.iter().map(String::as_str).collect();
    let (ranked, _) = names.rank(&title_refs, NOTE_LIMIT);
    let mut found: Vec<bool> = vec![false; ordered.len()];
    let mut matches: Vec<NoteMatch> = ranked
        .into_iter()
        .map(|r| {
            found[r.index] = true;
            note_match(ordered[r.index], lists, r.highlights)
        })
        .collect();

    let query: Vec<char> = query.trim().chars().map(folded).collect();
    if query.len() >= MIN_SUBSTRING {
        for (index, note) in ordered.iter().enumerate() {
            if matches.len() >= NOTE_LIMIT {
                break;
            }
            if found[index] {
                continue;
            }
            if let Some(snippet) = snippet(&note.text, &query) {
                let mut found = note_match(note, lists, Vec::new());
                found.snippet = Some(snippet);
                matches.push(found);
            }
        }
    }
    (list_matches, matches)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::notes::NoteList;

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
            search_notes(query, &self.lists, &self.notes)
        }
    }

    fn notes() -> Notes {
        Notes {
            lists: vec![
                NoteList {
                    id: "l1".into(),
                    name: "Architecture".into(),
                },
                NoteList {
                    id: "l2".into(),
                    name: "Release".into(),
                },
            ],
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
    fn notes_match_by_first_line_then_by_their_text() {
        let (_, found) = notes().search("watcher");
        let ids: Vec<&str> = found.iter().map(|n| n.id.as_str()).collect();
        // both first lines match; the open one first
        assert_eq!(ids, ["a", "d"]);
        assert_eq!(found[0].title, "Watcher plan");
        assert_eq!(found[0].list_name, "Architecture");
        assert!(found[1].done);

        let (_, found) = notes().search("per dir");
        assert_eq!(found.len(), 1);
        let snippet = found[0].snippet.as_ref().unwrap();
        // cut before, line breaks as spaces, nothing cut after
        assert!(snippet.text.starts_with('…'), "{}", snippet.text);
        assert!(snippet.text.ends_with(" 1. coalesce events per directory"));
        let [start, end] = snippet.highlights[0];
        let shown: Vec<u16> = snippet.text.encode_utf16().collect();
        assert_eq!(
            String::from_utf16(&shown[start as usize..end as usize]).unwrap(),
            "per dir"
        );
    }

    #[test]
    fn one_letter_is_not_looked_for_inside_notes() {
        let (_, found) = notes().search("q");
        assert!(found.iter().all(|n| n.snippet.is_none()));
    }

    #[test]
    fn notes_keep_to_their_lists_in_order() {
        let mut found = notes();
        // first in its list, but its list comes second
        found.notes.push(Note {
            list: "l2".into(),
            ..note("r", -9.0, "Watcher release note", None)
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
