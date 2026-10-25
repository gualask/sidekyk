//! A Markdown file as the preview's tree: pulldown-cmark's events, with their byte ranges, nested
//! into nodes, then turned into blocks the frontend renders. Raw HTML is dropped but `<br>`, a
//! front matter is hidden, footnotes go to the end.

use std::collections::HashMap;
use std::ops::Range;

use pulldown_cmark::{
    Alignment, BlockQuoteKind, CodeBlockKind, Event, LinkType, Options, Parser, Tag,
};

use super::contracts::{
    Alert, Align, Block, CodeLine, Footnote, Inline, ListItem, MarkdownDocument, Target,
};
use super::targets::{image_target, link_target, Slugger};

/// CommonMark with GitHub's tables, strikethrough, task lists, footnotes and alerts, and a YAML
/// front matter to hide.
const OPTIONS: Options = Options::ENABLE_TABLES
    .union(Options::ENABLE_STRIKETHROUGH)
    .union(Options::ENABLE_TASKLISTS)
    .union(Options::ENABLE_FOOTNOTES)
    .union(Options::ENABLE_GFM)
    .union(Options::ENABLE_YAML_STYLE_METADATA_BLOCKS);

/// The tree of the Markdown file at `file` (its path in the project, for relative links), whose
/// text is `text`. `is_file` says whether a path is a file of the project's tree.
pub fn parse_markdown(
    text: &str,
    file: &str,
    is_file: &dyn Fn(&str) -> bool,
    truncated: bool,
) -> MarkdownDocument {
    let (nodes, definitions) = nest(text);
    let mut reader = Reader {
        text,
        line_starts: line_starts(text),
        file,
        is_file,
        slugger: Slugger::default(),
        definitions,
        notes: Vec::new(),
    };
    let mut blocks = reader.blocks(nodes);
    if let Some(footnotes) = reader.footnotes() {
        blocks.push(footnotes);
    }
    MarkdownDocument { blocks, truncated }
}

/// An event with what it holds: a tag with its children, or a leaf.
enum Node<'a> {
    Element {
        tag: Tag<'a>,
        start: usize,
        children: Vec<Node<'a>>,
    },
    Leaf {
        event: Event<'a>,
        range: Range<usize>,
    },
}

impl Node<'_> {
    fn start(&self) -> usize {
        match self {
            Node::Element { start, .. } => *start,
            Node::Leaf { range, .. } => range.start,
        }
    }

    /// Whether it belongs in a line of text, as a tight list's item holds it with no paragraph.
    fn is_inline(&self) -> bool {
        match self {
            Node::Element { tag, .. } => matches!(
                tag,
                Tag::Emphasis
                    | Tag::Strong
                    | Tag::Strikethrough
                    | Tag::Link { .. }
                    | Tag::Image { .. }
            ),
            Node::Leaf { event, .. } => matches!(
                event,
                Event::Text(_)
                    | Event::Code(_)
                    | Event::InlineHtml(_)
                    | Event::FootnoteReference(_)
                    | Event::SoftBreak
                    | Event::HardBreak
            ),
        }
    }
}

/// Footnote definitions by their label (case ignored, as GitHub): where it starts, what it holds.
type Definitions<'a> = HashMap<String, (usize, Vec<Node<'a>>)>;

/// Tags nested deeper are left out, what they hold kept in the deepest: the tree is walked and
/// dropped recursively, and 10,000 quotes one in the other would overflow the stack.
const MAX_DEPTH: usize = 48;

/// The events nested by their tags; footnote definitions taken out, the first of a label kept.
fn nest(text: &str) -> (Vec<Node<'_>>, Definitions<'_>) {
    let mut open: Vec<(Tag, usize, Vec<Node>)> = Vec::new();
    let mut root = Vec::new();
    let mut definitions = Definitions::new();
    let mut too_deep = 0usize;
    for (event, range) in Parser::new_ext(text, OPTIONS).into_offset_iter() {
        let node = match event {
            Event::Start(_) if open.len() == MAX_DEPTH => {
                too_deep += 1;
                continue;
            }
            Event::End(_) if too_deep > 0 => {
                too_deep -= 1;
                continue;
            }
            Event::Start(tag) => {
                open.push((tag, range.start, Vec::new()));
                continue;
            }
            Event::End(_) => {
                let Some((tag, start, children)) = open.pop() else {
                    continue;
                };
                if let Tag::FootnoteDefinition(label) = &tag {
                    definitions
                        .entry(label.to_lowercase())
                        .or_insert((start, children));
                    continue;
                }
                Node::Element {
                    tag,
                    start,
                    children,
                }
            }
            event => Node::Leaf { event, range },
        };
        match open.last_mut() {
            Some((_, _, children)) => children.push(node),
            None => root.push(node),
        }
    }
    (root, definitions)
}

/// Where each line starts, in bytes.
fn line_starts(text: &str) -> Vec<usize> {
    std::iter::once(0)
        .chain(text.match_indices('\n').map(|(index, _)| index + 1))
        .collect()
}

struct Reader<'t, 'a> {
    text: &'t str,
    line_starts: Vec<usize>,
    file: &'t str,
    is_file: &'t dyn Fn(&str) -> bool,
    slugger: Slugger,
    definitions: Definitions<'a>,
    /// The footnotes referred to, in the order of their first reference: label and references.
    notes: Vec<(String, u32)>,
}

impl<'a> Reader<'_, 'a> {
    /// The line, from 1, of a byte of the text.
    fn line(&self, offset: usize) -> u32 {
        let index = self.line_starts.partition_point(|&start| start <= offset);
        u32::try_from(index.max(1)).unwrap_or(u32::MAX)
    }

    fn blocks(&mut self, nodes: Vec<Node<'a>>) -> Vec<Block> {
        let mut blocks = Vec::new();
        let mut text: Vec<Node> = Vec::new();
        for node in nodes {
            if node.is_inline() {
                text.push(node);
                continue;
            }
            self.plain(&mut text, &mut blocks);
            if let Some(block) = self.block(node) {
                blocks.push(block);
            }
        }
        self.plain(&mut text, &mut blocks);
        blocks
    }

    /// Text met outside a paragraph (a tight list's item) as a block of its own.
    fn plain(&mut self, text: &mut Vec<Node<'a>>, blocks: &mut Vec<Block>) {
        let Some(first) = text.first() else {
            return;
        };
        let line = self.line(first.start());
        let content = self.inlines(std::mem::take(text));
        if !content.is_empty() {
            blocks.push(Block::Plain { line, content });
        }
    }

    fn block(&mut self, node: Node<'a>) -> Option<Block> {
        let line = self.line(node.start());
        let (tag, children) = match node {
            Node::Leaf {
                event: Event::Rule, ..
            } => return Some(Block::Rule { line }),
            // raw HTML, math and anything else not enabled
            Node::Leaf { .. } => return None,
            Node::Element { tag, children, .. } => (tag, children),
        };
        Some(match tag {
            Tag::Paragraph => Block::Paragraph {
                line,
                content: self.inlines(children),
            },
            Tag::Heading { level, .. } => {
                let content = self.inlines(children);
                Block::Heading {
                    line,
                    level: level as u8,
                    id: self.slugger.id(&plain_text(&content)),
                    content,
                }
            }
            Tag::BlockQuote(kind) => Block::Quote {
                line,
                alert: kind.map(alert),
                blocks: self.blocks(children),
            },
            Tag::CodeBlock(kind) => Block::Code {
                line,
                language: match kind {
                    CodeBlockKind::Fenced(info) => info
                        .split_whitespace()
                        .next()
                        .map(|word| word.trim_matches(['{', '}', '.']).to_string())
                        .filter(|language| !language.is_empty()),
                    CodeBlockKind::Indented => None,
                },
                lines: self.code_lines(&children),
            },
            Tag::List(start) => Block::List {
                line,
                start,
                items: children
                    .into_iter()
                    .filter_map(|item| self.item(item))
                    .collect(),
            },
            Tag::Table(align) => {
                let mut head = Vec::new();
                let mut rows = Vec::new();
                for part in children {
                    let Node::Element { tag, children, .. } = part else {
                        continue;
                    };
                    match tag {
                        Tag::TableHead => head = self.cells(children),
                        Tag::TableRow => rows.push(self.cells(children)),
                        _ => {}
                    }
                }
                Block::Table {
                    line,
                    align: align.into_iter().map(aligned).collect(),
                    head,
                    rows,
                }
            }
            // raw HTML, a front matter
            _ => return None,
        })
    }

    fn item(&mut self, node: Node<'a>) -> Option<ListItem> {
        let Node::Element {
            tag: Tag::Item,
            start,
            mut children,
        } = node
        else {
            return None;
        };
        let task = match children.first() {
            Some(Node::Leaf {
                event: Event::TaskListMarker(checked),
                ..
            }) => Some(*checked),
            _ => None,
        };
        if task.is_some() {
            children.remove(0);
        }
        Some(ListItem {
            line: self.line(start),
            task,
            blocks: self.blocks(children),
        })
    }

    fn cells(&mut self, cells: Vec<Node<'a>>) -> Vec<Vec<Inline>> {
        cells
            .into_iter()
            .filter_map(|cell| match cell {
                Node::Element {
                    tag: Tag::TableCell,
                    children,
                    ..
                } => Some(self.inlines(children)),
                _ => None,
            })
            .collect()
    }

    /// A code block's lines as the file has them, each from where the block's text starts on it.
    fn code_lines(&self, children: &[Node]) -> Vec<CodeLine> {
        let mut lines: Vec<CodeLine> = Vec::new();
        for child in children {
            let Node::Leaf {
                event: Event::Text(_),
                range,
            } = child
            else {
                continue;
            };
            let Some(text) = self.text.get(range.clone()) else {
                continue;
            };
            let mut offset = range.start;
            for piece in text.split_inclusive('\n') {
                let number = self.line(offset);
                if lines.last().is_none_or(|last| last.number < number) {
                    lines.push(self.code_line(number, offset));
                }
                offset += piece.len();
            }
        }
        lines
    }

    fn code_line(&self, number: u32, offset: usize) -> CodeLine {
        let start = self.line_starts[number as usize - 1];
        let end = self
            .line_starts
            .get(number as usize)
            .map_or(self.text.len(), |next| next - 1);
        let text = &self.text[start..end.max(start)];
        let before = &self.text[start..offset.clamp(start, start + text.len())];
        CodeLine {
            number,
            text: text.to_string(),
            from: u32::try_from(before.encode_utf16().count()).unwrap_or(u32::MAX),
        }
    }

    fn inlines(&mut self, nodes: Vec<Node<'a>>) -> Vec<Inline> {
        let mut content = Vec::new();
        for node in nodes {
            match node {
                Node::Leaf { event, .. } => match event {
                    Event::Text(text) => push_text(&mut content, &text),
                    Event::SoftBreak => push_text(&mut content, "\n"),
                    Event::Code(text) => content.push(Inline::Code {
                        text: text.into_string(),
                    }),
                    Event::HardBreak => content.push(Inline::Break),
                    Event::InlineHtml(html) if is_line_break(&html) => content.push(Inline::Break),
                    Event::FootnoteReference(label) => match self.reference(&label) {
                        Some(reference) => content.push(reference),
                        None => push_text(&mut content, &format!("[^{label}]")),
                    },
                    // other raw HTML is dropped: what is between its tags stays
                    _ => {}
                },
                Node::Element { tag, children, .. } => match tag {
                    Tag::Emphasis => content.push(Inline::Emphasis {
                        content: self.inlines(children),
                    }),
                    Tag::Strong => content.push(Inline::Strong {
                        content: self.inlines(children),
                    }),
                    Tag::Strikethrough => content.push(Inline::Strikethrough {
                        content: self.inlines(children),
                    }),
                    Tag::Link {
                        link_type,
                        dest_url,
                        title,
                        ..
                    } => {
                        let target = if link_type == LinkType::Email {
                            Some(Target::Web {
                                url: format!("mailto:{dest_url}"),
                            })
                        } else {
                            link_target(&dest_url, self.file, self.is_file)
                        };
                        content.push(Inline::Link {
                            target,
                            title: non_empty(&title),
                            content: self.inlines(children),
                        });
                    }
                    Tag::Image {
                        dest_url, title, ..
                    } => {
                        let alt = plain_text(&self.inlines(children));
                        content.push(Inline::Image {
                            target: image_target(&dest_url, self.file, self.is_file),
                            alt,
                            title: non_empty(&title),
                        });
                    }
                    _ => {
                        for inline in self.inlines(children) {
                            match inline {
                                Inline::Text { text } => push_text(&mut content, &text),
                                inline => content.push(inline),
                            }
                        }
                    }
                },
            }
        }
        content
    }

    /// A reference to a defined footnote, numbered by the first reference to each.
    fn reference(&mut self, label: &str) -> Option<Inline> {
        let label = label.to_lowercase();
        let index = match self.notes.iter().position(|(known, _)| *known == label) {
            Some(index) => index,
            None if self.definitions.contains_key(&label) => {
                self.notes.push((label, 0));
                self.notes.len() - 1
            }
            None => return None,
        };
        self.notes[index].1 += 1;
        Some(Inline::FootnoteRef {
            number: u32::try_from(index + 1).unwrap_or(u32::MAX),
            nth: self.notes[index].1,
        })
    }

    /// The footnotes referred to, in order; a footnote may refer to a later one.
    fn footnotes(&mut self) -> Option<Block> {
        let mut notes = Vec::new();
        let mut index = 0;
        while let Some((label, _)) = self.notes.get(index) {
            let (start, children) = self
                .definitions
                .remove(label)
                .expect("only defined footnotes are numbered");
            notes.push(Footnote {
                number: u32::try_from(index + 1).unwrap_or(u32::MAX),
                line: self.line(start),
                references: 0,
                blocks: self.blocks(children),
            });
            index += 1;
        }
        for (note, (_, references)) in notes.iter_mut().zip(&self.notes) {
            note.references = *references;
        }
        let line = notes.first()?.line;
        Some(Block::Footnotes { line, notes })
    }
}

fn push_text(content: &mut Vec<Inline>, more: &str) {
    match content.last_mut() {
        Some(Inline::Text { text }) => text.push_str(more),
        _ => content.push(Inline::Text { text: more.into() }),
    }
}

/// `<br>`, `<br/>`, `<br />`, case ignored: the one raw HTML the preview keeps.
fn is_line_break(html: &str) -> bool {
    let tag = html.trim();
    ["<br>", "<br/>", "<br />"]
        .iter()
        .any(|br| br.eq_ignore_ascii_case(tag))
}

/// What a line of text reads, without its marks: a heading's id and an image's description.
fn plain_text(content: &[Inline]) -> String {
    let mut text = String::new();
    for inline in content {
        match inline {
            Inline::Text { text: part } | Inline::Code { text: part } => text.push_str(part),
            Inline::Emphasis { content }
            | Inline::Strong { content }
            | Inline::Strikethrough { content }
            | Inline::Link { content, .. } => text.push_str(&plain_text(content)),
            Inline::Image { alt, .. } => text.push_str(alt),
            Inline::Break => text.push(' '),
            Inline::FootnoteRef { .. } => {}
        }
    }
    text
}

fn non_empty(text: &str) -> Option<String> {
    (!text.is_empty()).then(|| text.to_string())
}

fn alert(kind: BlockQuoteKind) -> Alert {
    match kind {
        BlockQuoteKind::Note => Alert::Note,
        BlockQuoteKind::Tip => Alert::Tip,
        BlockQuoteKind::Important => Alert::Important,
        BlockQuoteKind::Warning => Alert::Warning,
        BlockQuoteKind::Caution => Alert::Caution,
    }
}

fn aligned(alignment: Alignment) -> Align {
    match alignment {
        Alignment::None => Align::None,
        Alignment::Left => Align::Left,
        Alignment::Center => Align::Center,
        Alignment::Right => Align::Right,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(text: &str) -> Vec<Block> {
        let is_file = |path: &str| ["docs/other.md", "docs/logo.png"].contains(&path);
        parse_markdown(text, "docs/guide.md", &is_file, false).blocks
    }

    fn text(text: &str) -> Inline {
        Inline::Text { text: text.into() }
    }

    #[test]
    fn blocks_carry_the_line_they_start_on() {
        let blocks = parse("# Title\n\nFirst\nsecond\n\n---\n\n> quoted\n");
        assert_eq!(
            blocks,
            vec![
                Block::Heading {
                    line: 1,
                    level: 1,
                    id: "user-content-title".into(),
                    content: vec![text("Title")],
                },
                Block::Paragraph {
                    line: 3,
                    content: vec![text("First\nsecond")],
                },
                Block::Rule { line: 6 },
                Block::Quote {
                    line: 8,
                    alert: None,
                    blocks: vec![Block::Paragraph {
                        line: 8,
                        content: vec![text("quoted")],
                    }],
                },
            ]
        );
    }

    #[test]
    fn a_front_matter_is_hidden_and_lines_after_it_keep_their_numbers() {
        let blocks = parse("---\ntitle: x\n---\n\n# After\n");
        assert_eq!(
            blocks,
            vec![Block::Heading {
                line: 5,
                level: 1,
                id: "user-content-after".into(),
                content: vec![text("After")],
            }]
        );
    }

    #[test]
    fn raw_html_is_dropped_but_line_breaks_and_the_text_between_tags() {
        let blocks = parse("<div align=\"center\">\n<img src=\"x.png\">\n</div>\n\nPress <kbd>⌘</kbd><br/>then <!-- note --><script>x</script>go\n");
        assert_eq!(
            blocks,
            vec![Block::Paragraph {
                line: 5,
                content: vec![text("Press ⌘"), Inline::Break, text("then xgo")],
            }]
        );
    }

    #[test]
    fn tight_lists_hold_plain_text_and_tasks_their_state() {
        let blocks = parse("3. one\n4. two\n\n- [x] done\n- [ ] open\n");
        let Block::List { start, items, .. } = &blocks[0] else {
            panic!("{blocks:?}")
        };
        assert_eq!(*start, Some(3));
        assert_eq!(
            items[1].blocks,
            vec![Block::Plain {
                line: 2,
                content: vec![text("two")],
            }]
        );
        let Block::List { start, items, .. } = &blocks[1] else {
            panic!("{blocks:?}")
        };
        assert_eq!(*start, None);
        assert_eq!(
            items.iter().map(|item| item.task).collect::<Vec<_>>(),
            [Some(true), Some(false)]
        );
    }

    #[test]
    fn code_lines_are_the_files_with_where_the_code_starts() {
        let blocks = parse("- item\n\n  ```rust\n  fn a() {}\n\n  é b\n  ```\n");
        let Block::List { items, .. } = &blocks[0] else {
            panic!("{blocks:?}")
        };
        assert_eq!(
            items[0].blocks[1],
            Block::Code {
                line: 3,
                language: Some("rust".into()),
                lines: vec![
                    CodeLine {
                        number: 4,
                        text: "  fn a() {}".into(),
                        from: 2,
                    },
                    CodeLine {
                        number: 5,
                        text: String::new(),
                        from: 0,
                    },
                    CodeLine {
                        number: 6,
                        text: "  é b".into(),
                        from: 2,
                    },
                ],
            }
        );
        let blocks = parse("text\n\n    indented\r\n");
        assert_eq!(
            blocks[1],
            Block::Code {
                line: 3,
                language: None,
                lines: vec![CodeLine {
                    number: 3,
                    text: "    indented\r".into(),
                    from: 4,
                }],
            }
        );
    }

    #[test]
    fn footnotes_go_last_numbered_by_first_reference() {
        let blocks = parse(
            "A[^z] b[^a] c[^z] d[^none].\n\n[^a]: First defined.\n\n[^z]: Second defined.\n\n[^unused]: Never.\n",
        );
        assert_eq!(
            blocks[0],
            Block::Paragraph {
                line: 1,
                content: vec![
                    text("A"),
                    Inline::FootnoteRef { number: 1, nth: 1 },
                    text(" b"),
                    Inline::FootnoteRef { number: 2, nth: 1 },
                    text(" c"),
                    Inline::FootnoteRef { number: 1, nth: 2 },
                    text(" d[^none]."),
                ],
            }
        );
        assert_eq!(
            blocks[1],
            Block::Footnotes {
                line: 5,
                notes: vec![
                    Footnote {
                        number: 1,
                        line: 5,
                        references: 2,
                        blocks: vec![Block::Paragraph {
                            line: 5,
                            content: vec![text("Second defined.")],
                        }],
                    },
                    Footnote {
                        number: 2,
                        line: 3,
                        references: 1,
                        blocks: vec![Block::Paragraph {
                            line: 3,
                            content: vec![text("First defined.")],
                        }],
                    },
                ],
            }
        );
        assert_eq!(blocks.len(), 2);
    }

    #[test]
    fn links_and_images_are_resolved() {
        let blocks = parse(
            "[o](other.md#Run \"T\") [x](javascript:alert(1)) <a@b.c> ![logo](logo.png) ![b](https://x/b.svg)\n",
        );
        let Block::Paragraph { content, .. } = &blocks[0] else {
            panic!("{blocks:?}")
        };
        assert_eq!(
            content[0],
            Inline::Link {
                target: Some(Target::File {
                    path: "docs/other.md".into(),
                    anchor: Some("user-content-Run".into()),
                }),
                title: Some("T".into()),
                content: vec![text("o")],
            }
        );
        assert_eq!(
            content[2],
            Inline::Link {
                target: None,
                title: None,
                content: vec![text("x")],
            }
        );
        assert_eq!(
            content[4],
            Inline::Link {
                target: Some(Target::Web {
                    url: "mailto:a@b.c".into()
                }),
                title: None,
                content: vec![text("a@b.c")],
            }
        );
        assert_eq!(
            content[6],
            Inline::Image {
                target: Some(Target::File {
                    path: "docs/logo.png".into(),
                    anchor: None,
                }),
                alt: "logo".into(),
                title: None,
            }
        );
        assert_eq!(
            content[8],
            Inline::Image {
                target: Some(Target::Web {
                    url: "https://x/b.svg".into()
                }),
                alt: "b".into(),
                title: None,
            }
        );
    }

    #[test]
    fn tables_alerts_and_repeated_headings() {
        let blocks =
            parse("| a | b |\n|:-|-:|\n| 1 |\n\n> [!WARNING]\n> Careful\n\n## Same\n\n## Same\n");
        assert_eq!(
            blocks[0],
            Block::Table {
                line: 1,
                align: vec![Align::Left, Align::Right],
                head: vec![vec![text("a")], vec![text("b")]],
                rows: vec![vec![vec![text("1")], vec![]]],
            }
        );
        let Block::Quote { alert, .. } = &blocks[1] else {
            panic!("{blocks:?}")
        };
        assert_eq!(*alert, Some(Alert::Warning));
        let ids: Vec<_> = blocks[2..]
            .iter()
            .filter_map(|block| match block {
                Block::Heading { id, .. } => Some(id.as_str()),
                _ => None,
            })
            .collect();
        assert_eq!(ids, ["user-content-same", "user-content-same-1"]);
    }

    #[test]
    fn pathological_inputs_stay_fast() {
        let nested = format!("{}a{}", "[".repeat(50_000), "]".repeat(50_000));
        let quotes = format!("{}a", "> ".repeat(10_000));
        for text in [nested, quotes] {
            let started = std::time::Instant::now();
            parse(&text);
            assert!(started.elapsed().as_secs() < 2, "{:?}", started.elapsed());
        }
    }
}
