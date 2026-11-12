import {
    type Icon,
    IconAlertOctagon,
    IconAlertTriangle,
    IconBulb,
    IconInfoCircle,
    IconMessageReport,
} from '@tabler/icons-react';
import { type MessageKey, useTranslation } from '@/shared/i18n';
import { footnoteId, footnoteRefId, kindKeys } from '../../../../../model/preview/preview';
import type { MarkdownAlert, MarkdownBlock } from '../../../../../model/repository.types';
import { Inlines } from '../Inlines';
import { usePreview } from '../preview-context';
import { CodeBlock } from './CodeBlock';
import { MermaidBlock } from './MermaidBlock';
import { TableBlock } from './TableBlock';

type BlockOf<Kind extends MarkdownBlock['kind']> = Extract<MarkdownBlock, { kind: Kind }>;

const HEADING_CLASS = [
    '',
    'mt-6 text-[1.9em] font-bold leading-tight',
    'mt-6 text-[1.45em] font-bold leading-tight',
    'mt-5 text-[1.2em] font-semibold',
    'mt-4 text-[1.05em] font-semibold',
    'mt-4 text-[0.95em] font-semibold',
    'mt-4 text-[0.9em] font-semibold text-ui-text-muted',
];

const ALERTS: Record<MarkdownAlert, { title: MessageKey; Icon: Icon; tone: string }> = {
    note: { title: 'preview.alert.note', Icon: IconInfoCircle, tone: 'text-ui-accent-text' },
    tip: { title: 'preview.alert.tip', Icon: IconBulb, tone: 'text-ui-success' },
    important: {
        title: 'preview.alert.important',
        Icon: IconMessageReport,
        tone: 'text-ui-important',
    },
    warning: { title: 'preview.alert.warning', Icon: IconAlertTriangle, tone: 'text-ui-warning' },
    caution: { title: 'preview.alert.caution', Icon: IconAlertOctagon, tone: 'text-ui-danger' },
};

/** Blocks nested in another: a quote's, a list item's, a footnote's. */
function Blocks({ blocks }: { blocks: readonly MarkdownBlock[] }) {
    const keys = kindKeys(blocks);
    return (
        <>
            {blocks.map((block, index) => (
                <div key={keys[index]} className="mt-3 first:mt-0">
                    <Block block={block} />
                </div>
            ))}
        </>
    );
}

/** A block of the document, by its kind. */
export function Block({ block }: { block: MarkdownBlock }) {
    switch (block.kind) {
        case 'paragraph':
        case 'plain':
            return (
                <p>
                    <Inlines content={block.content} />
                </p>
            );
        case 'heading':
            return <Heading block={block} />;
        case 'quote':
            return <Quote block={block} />;
        case 'list':
            return <List block={block} />;
        case 'code':
            return <CodeBlock lines={block.lines} />;
        case 'diagram':
            return <MermaidBlock block={block} />;
        case 'table':
            return <TableBlock block={block} />;
        case 'rule':
            return <hr className="my-3 border-ui-border" />;
        case 'footnotes':
            return <Footnotes block={block} />;
    }
}

function Heading({ block }: { block: BlockOf<'heading'> }) {
    const Tag = `h${Math.min(Math.max(block.level, 1), 6)}` as 'h1';
    return (
        <Tag id={block.id} className={HEADING_CLASS[block.level] ?? HEADING_CLASS[6]}>
            <Inlines content={block.content} />
        </Tag>
    );
}

/** A quote, or a GitHub alert: a quote headed by its kind, in its tone. */
function Quote({ block }: { block: BlockOf<'quote'> }) {
    const i18n = useTranslation();
    const alert = block.alert ? ALERTS[block.alert] : null;
    return (
        <blockquote
            className={`border-l-[3px] pl-4 ${
                alert ? `border-current ${alert.tone}` : 'border-ui-border text-ui-text-dim'
            }`}
        >
            {alert ? (
                <p className="mb-1 flex items-center gap-1.5 font-semibold">
                    <alert.Icon size={16} />
                    {i18n.t(alert.title)}
                </p>
            ) : null}
            <div className={alert ? 'text-ui-text' : undefined}>
                <Blocks blocks={block.blocks} />
            </div>
        </blockquote>
    );
}

/** A list, numbered from `start` or not; a task list's items with their checkbox. */
function List({ block }: { block: BlockOf<'list'> }) {
    const tasks = block.items.some((item) => item.task !== null);
    const items = block.items.map((item) => <ListItem key={item.line} item={item} />);
    const space = tasks ? 'list-none space-y-0.5' : 'space-y-0.5 pl-6';
    return block.start === null ? (
        <ul className={`${space} ${tasks ? '' : 'list-disc'}`}>{items}</ul>
    ) : (
        <ol start={block.start} className={`${space} list-decimal`}>
            {items}
        </ol>
    );
}

/** A list's item, with its checkbox in a task list. */
function ListItem({ item }: { item: BlockOf<'list'>['items'][number] }) {
    return (
        <li className={item.task === null ? 'pl-1' : 'flex gap-2'}>
            {item.task === null ? null : (
                <input
                    type="checkbox"
                    checked={item.task}
                    disabled
                    readOnly
                    className="mt-[0.45em] shrink-0 accent-ui-accent"
                />
            )}
            <div className="min-w-0">
                <Blocks blocks={item.blocks} />
            </div>
        </li>
    );
}

/** The footnotes, gathered at the end, each with its links back. */
function Footnotes({ block }: { block: BlockOf<'footnotes'> }) {
    const i18n = useTranslation();
    return (
        <section className="mt-6 border-t border-ui-border pt-4 text-[0.9em] text-ui-text-dim">
            <h2 className="mb-2 font-semibold text-ui-text-muted">{i18n.t('preview.footnotes')}</h2>
            <ol className="list-decimal space-y-1 pl-6">
                {block.notes.map((note) => (
                    <Footnote key={note.number} note={note} />
                ))}
            </ol>
        </section>
    );
}

/** A footnote; one of one paragraph, as most are, ends with its links back on its last line. */
function Footnote({ note }: { note: BlockOf<'footnotes'>['notes'][number] }) {
    const only = note.blocks.length === 1 ? note.blocks[0] : null;
    return (
        <li id={footnoteId(note.number)}>
            {only?.kind === 'paragraph' ? (
                <p>
                    <Inlines content={only.content} />
                    <BackLinks number={note.number} references={note.references} />
                </p>
            ) : (
                <>
                    <Blocks blocks={note.blocks} />
                    <BackLinks number={note.number} references={note.references} />
                </>
            )}
        </li>
    );
}

/** A footnote's links back to each reference to it. */
function BackLinks({ number, references }: { number: number; references: number }) {
    const { goTo } = usePreview();
    const i18n = useTranslation();
    const ids = Array.from({ length: references }, (_, index) => footnoteRefId(number, index + 1));
    return (
        <span className="ml-1">
            {ids.map((id, index) => (
                <a
                    key={id}
                    href={`#${id}`}
                    className="ml-1 text-ui-accent-text hover:underline"
                    aria-label={i18n.t('preview.footnoteBack', { number: String(number) })}
                    onClick={(event) => {
                        event.preventDefault();
                        goTo(id);
                    }}
                >
                    ↩{index > 0 ? <sup>{index + 1}</sup> : null}
                </a>
            ))}
        </span>
    );
}
