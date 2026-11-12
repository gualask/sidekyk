//! A Markdown file as the preview's tree: pulldown-cmark's events nested into nodes (`nesting`),
//! then turned into blocks the frontend renders (`blocks`, `code`, `inlines`, `footnotes`). Raw
//! HTML is dropped but `<br>`, a front matter is hidden, footnotes go to the end.

mod blocks;
mod code;
mod footnotes;
mod inlines;
mod nesting;

use super::contracts::MarkdownDocument;
use super::targets::Slugger;
use nesting::{nest, Definitions};

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
}

#[cfg(test)]
mod tests {
    use super::super::contracts::{Alert, Align, Block, CodeLine, Footnote, Inline, Target};
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
    fn a_mermaid_block_is_a_diagram_with_its_source() {
        let blocks = parse("- item\n\n  ```Mermaid title\n  flowchart TD\n    A --> B\n  ```\n");
        let Block::List { items, .. } = &blocks[0] else {
            panic!("{blocks:?}")
        };
        assert_eq!(
            items[0].blocks[1],
            Block::Diagram {
                line: 3,
                source: "flowchart TD\n  A --> B\n".into(),
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
