import type { ReactNode } from 'react';
import { footnoteId, footnoteRefId, kindKeys } from '../../../../model/preview/preview';
import type { MarkdownInline } from '../../../../model/repository.types';
import { PreviewImage } from './PreviewImage';
import { PreviewLink } from './PreviewLink';
import { InLink, usePreview } from './preview-context';

/** The text of a block: its inline nodes, each keyed by its kind. */
export function Inlines({ content }: { content: readonly MarkdownInline[] }) {
    const keys = kindKeys(content);
    return content.map((inline, index) => <InlineNode key={keys[index]} inline={inline} />);
}

function InlineNode({ inline }: { inline: MarkdownInline }): ReactNode {
    switch (inline.kind) {
        case 'text':
            return inline.text;
        case 'code':
            return (
                <code className="rounded bg-ui-surface-hover px-1 py-0.5 font-mono text-[0.86em]">
                    {inline.text}
                </code>
            );
        case 'emphasis':
            return (
                <em>
                    <Inlines content={inline.content} />
                </em>
            );
        case 'strong':
            return (
                <strong className="font-semibold">
                    <Inlines content={inline.content} />
                </strong>
            );
        case 'strikethrough':
            return (
                <del className="text-ui-text-muted">
                    <Inlines content={inline.content} />
                </del>
            );
        case 'link':
            return (
                <PreviewLink target={inline.target} title={inline.title}>
                    <InLink.Provider value={true}>
                        <Inlines content={inline.content} />
                    </InLink.Provider>
                </PreviewLink>
            );
        case 'image':
            return <PreviewImage target={inline.target} alt={inline.alt} title={inline.title} />;
        case 'break':
            return <br />;
        case 'footnoteRef':
            return <FootnoteRef number={inline.number} nth={inline.nth} />;
    }
}

/** The `nth` reference to a footnote: its number, leading to it. */
function FootnoteRef({ number, nth }: { number: number; nth: number }) {
    const { goTo } = usePreview();
    const target = footnoteId(number);
    return (
        <sup id={footnoteRefId(number, nth)}>
            <a
                href={`#${target}`}
                className="px-0.5 text-ui-accent-text hover:underline"
                onClick={(event) => {
                    event.preventDefault();
                    goTo(target);
                }}
            >
                {number}
            </a>
        </sup>
    );
}
