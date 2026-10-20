//! A project's notes as one Markdown file, to keep them outside the app: a section per list in
//! the user's order, open notes by place, then the done ones, the last done first.

use super::contracts::{Note, NoteList};

/// Between two notes: a thematic break, which no note's text can be mistaken for once blank
/// lines surround it.
const BETWEEN: &str = "\n\n---\n\n";

/// Notes one after the other, each as typed.
fn texts(notes: &[&Note]) -> String {
    let texts: Vec<&str> = notes.iter().map(|n| n.text.trim_end()).collect();
    texts.join(BETWEEN)
}

/// The words an export adds to the notes, in the UI's language.
pub struct ExportWords {
    /// After the project's name, in the title: `# shop: notes`.
    pub notes: &'static str,
    /// A list without notes.
    pub no_notes: &'static str,
    /// Over a list's done notes.
    pub done: &'static str,
}

/// The Markdown of a project's notes, `name` its title.
pub fn to_markdown(name: &str, lists: &[NoteList], notes: &[Note], words: &ExportWords) -> String {
    let mut out = format!("# {name}: {}\n\n", words.notes);
    for list in lists {
        let mut open: Vec<&Note> = notes
            .iter()
            .filter(|n| n.list == list.id && n.done.is_none())
            .collect();
        open.sort_by(|a, b| a.position.total_cmp(&b.position));
        let mut done: Vec<&Note> = notes
            .iter()
            .filter(|n| n.list == list.id && n.done.is_some())
            .collect();
        done.sort_by_key(|n| std::cmp::Reverse(n.done));
        out.push_str(&format!("## {}\n\n", list.name));
        if open.is_empty() && done.is_empty() {
            out.push_str(&format!("{}\n\n", words.no_notes));
        }
        if !open.is_empty() {
            out.push_str(&format!("{}\n\n", texts(&open)));
        }
        if !done.is_empty() {
            out.push_str(&format!("### {}\n\n{}\n\n", words.done, texts(&done)));
        }
    }
    out.truncate(out.trim_end().len());
    out.push('\n');
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const WORDS: ExportWords = ExportWords {
        notes: "notes",
        no_notes: "No notes.",
        done: "Done",
    };

    fn note(list: &str, position: f64, text: &str, done: Option<u64>) -> Note {
        Note {
            id: format!("{position}"),
            list: list.into(),
            position,
            text: text.into(),
            created: 0,
            edited: 0,
            done,
        }
    }

    #[test]
    fn lists_in_order_open_notes_by_place_then_done_ones() {
        let lists = [
            NoteList {
                id: "g".into(),
                name: "General".into(),
            },
            NoteList {
                id: "r".into(),
                name: "Release".into(),
            },
        ];
        let notes = [
            note("g", 2.0, "Second\n", None),
            note("g", 1.0, "First\nwith a line", None),
            note("g", 3.0, "Old", Some(1)),
            note("g", 4.0, "Older", Some(0)),
        ];
        assert_eq!(
            to_markdown("shop", &lists, &notes, &WORDS),
            "# shop: notes\n\n\
             ## General\n\n\
             First\nwith a line\n\n---\n\nSecond\n\n\
             ### Done\n\n\
             Old\n\n---\n\nOlder\n\n\
             ## Release\n\n\
             No notes.\n"
        );
    }
}
