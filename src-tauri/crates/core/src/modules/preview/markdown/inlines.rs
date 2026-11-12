//! The inlines of a block: text, code, emphasis, links, images and line breaks.

use pulldown_cmark::{Event, LinkType, Tag};

use super::super::contracts::{Inline, Target};
use super::super::targets::{image_target, link_target};
use super::nesting::Node;
use super::Reader;

impl<'a> Reader<'_, 'a> {
    pub(super) fn inlines(&mut self, nodes: Vec<Node<'a>>) -> Vec<Inline> {
        let mut content = Vec::new();
        for node in nodes {
            match node {
                Node::Leaf { event, .. } => self.leaf(&mut content, event),
                Node::Element { tag, children, .. } => self.element(&mut content, tag, children),
            }
        }
        content
    }

    fn leaf(&mut self, content: &mut Vec<Inline>, event: Event<'a>) {
        match event {
            Event::Text(text) => push_text(content, &text),
            Event::SoftBreak => push_text(content, "\n"),
            Event::Code(text) => content.push(Inline::Code {
                text: text.into_string(),
            }),
            Event::HardBreak => content.push(Inline::Break),
            Event::InlineHtml(html) if is_line_break(&html) => content.push(Inline::Break),
            Event::FootnoteReference(label) => match self.reference(&label) {
                Some(reference) => content.push(reference),
                None => push_text(content, &format!("[^{label}]")),
            },
            // other raw HTML is dropped: what is between its tags stays
            _ => {}
        }
    }

    fn element(&mut self, content: &mut Vec<Inline>, tag: Tag<'a>, children: Vec<Node<'a>>) {
        match tag {
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
            } => content.push(self.link(link_type, &dest_url, &title, children)),
            Tag::Image {
                dest_url, title, ..
            } => content.push(self.image(&dest_url, &title, children)),
            _ => push_inlines(content, self.inlines(children)),
        }
    }

    fn link(
        &mut self,
        link_type: LinkType,
        url: &str,
        title: &str,
        children: Vec<Node<'a>>,
    ) -> Inline {
        let target = if link_type == LinkType::Email {
            Some(Target::Web {
                url: format!("mailto:{url}"),
            })
        } else {
            link_target(url, self.file, self.is_file)
        };
        Inline::Link {
            target,
            title: non_empty(title),
            content: self.inlines(children),
        }
    }

    /// An image, its text for who cannot see it from what the markdown puts in its brackets.
    fn image(&mut self, url: &str, title: &str, children: Vec<Node<'a>>) -> Inline {
        let alt = plain_text(&self.inlines(children));
        Inline::Image {
            target: image_target(url, self.file, self.is_file),
            alt,
            title: non_empty(title),
        }
    }
}

/// The inlines of a tag shown as its content alone, their text joined to the text around them.
fn push_inlines(content: &mut Vec<Inline>, more: Vec<Inline>) {
    for inline in more {
        match inline {
            Inline::Text { text } => push_text(content, &text),
            inline => content.push(inline),
        }
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
pub(super) fn plain_text(content: &[Inline]) -> String {
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
