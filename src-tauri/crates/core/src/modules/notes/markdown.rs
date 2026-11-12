//! A project's notes as one Markdown file, to keep them outside the app: a section per list in
//! the user's order, open notes by place, then the done ones, the last done first. A note's
//! images follow its text, linked from `images/` beside the file.

use super::contracts::{Note, NoteList};
use super::images::image_file;

/// The folder beside the Markdown file that an export's images are in.
pub const EXPORT_IMAGES: &str = "images";

/// Between two notes: a thematic break, which no note's text can be mistaken for once blank
/// lines surround it.
const BETWEEN: &str = "\n\n---\n\n";

/// A note as typed, then its images.
fn note_markdown(note: &Note) -> String {
    let mut out = note.text.trim_end().to_string();
    for image in &note.images {
        if !out.is_empty() {
            out.push_str("\n\n");
        }
        out.push_str(&format!("![]({EXPORT_IMAGES}/{})", image_file(image)));
    }
    out
}

/// Notes one after the other.
fn texts(notes: &[&Note]) -> String {
    let texts: Vec<String> = notes.iter().map(|n| note_markdown(n)).collect();
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
        push_list(&mut out, list, notes, words);
    }
    out.truncate(out.trim_end().len());
    out.push('\n');
    out
}

/// A list's section: its name, then its open notes, then its done ones under their heading.
fn push_list(out: &mut String, list: &NoteList, notes: &[Note], words: &ExportWords) {
    let (open, done) = list_notes(list, notes);
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

/// A list's open notes by place, and its done ones, the last done first.
fn list_notes<'a>(list: &NoteList, notes: &'a [Note]) -> (Vec<&'a Note>, Vec<&'a Note>) {
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
    (open, done)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::notes::{ImageKind, NoteImage};

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
            images: Vec::new(),
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

    #[test]
    fn a_note_s_images_follow_its_text() {
        let image = |id: &str, kind| NoteImage {
            id: id.into(),
            kind,
            width: 1,
            height: 1,
            bytes: 1,
            marked: None,
        };
        let lists = [NoteList {
            id: "g".into(),
            name: "General".into(),
        }];
        let notes = [
            Note {
                images: vec![image("00112233445566ff", ImageKind::Png)],
                ..note("g", 1.0, "Look\n", None)
            },
            Note {
                images: vec![image("ffeeddccbbaa9988", ImageKind::Jpeg)],
                ..note("g", 2.0, "", None)
            },
        ];
        assert_eq!(
            to_markdown("shop", &lists, &notes, &WORDS),
            "# shop: notes\n\n\
             ## General\n\n\
             Look\n\n![](images/00112233445566ff.png)\n\n---\n\n\
             ![](images/ffeeddccbbaa9988.jpg)\n"
        );
    }
}
