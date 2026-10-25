import {
    type Icon,
    IconAlertOctagon,
    IconAlertTriangle,
    IconBulb,
    IconInfoCircle,
    IconMessageReport,
    IconPhoto,
} from '@tabler/icons-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
    createContext,
    type MouseEvent,
    type ReactNode,
    type RefObject,
    useContext,
    useEffect,
    useImperativeHandle,
    useMemo,
    useRef,
    useState,
} from 'react';
import { type MessageKey, useTranslation } from '@/shared/i18n';
import { useImageSource, useSyntaxColors } from '../application/repository.queries';
import { useRepositorySettings } from '../application/repository-settings';
import type { DiffLine } from '../model/diff-parser';
import {
    blockAtLine,
    blocksById,
    footnoteId,
    footnoteRefId,
    kindKeys,
    tableCells,
} from '../model/preview';
import type {
    MarkdownAlert,
    MarkdownBlock,
    MarkdownCodeLine,
    MarkdownDocument,
    MarkdownInline,
    MarkdownTarget,
} from '../model/repository.types';
import { blocksOf, fileSides, type LineSpans, textParts } from '../model/syntax';
import { TONE_CLASS } from './syntax-tones';

/** Where a preview is read: its first line on screen, for the code to open on. */
export interface PreviewPlace {
    topLine: () => number | null;
}

/** Where a preview opens: on a line of the file, else on an element of it. */
export interface PreviewOpenOn {
    line: number | null;
    anchor: string | null;
}

/** What the preview's links do outside it. */
export interface PreviewActions {
    /** A file of the project's tree, at an element of it if `anchor`. */
    openFile: (path: string, anchor: string | null) => void;
    /** `http`, `https`, `mailto`: in the system's browser or mail app. */
    openUrl: (url: string) => void;
}

/** What every block of a document needs, without passing it down each level. */
interface Context {
    projectId: string;
    path: string;
    actions: PreviewActions;
    goTo: (id: string) => void;
    wrap: boolean;
}

const PreviewContext = createContext<Context | null>(null);

/** Inside a link: an image there shows, its click being the link's. */
const InLink = createContext(false);

function usePreview(): Context {
    const context = useContext(PreviewContext);
    if (!context) throw new Error('usePreview must be used within a MarkdownPreview');
    return context;
}

const PADDING = { start: 28, end: 64 };

/** A first guess of a block's height, before it is measured. */
function estimate(block: MarkdownBlock): number {
    switch (block.kind) {
        case 'code':
            return 40 + block.lines.length * 20;
        case 'list':
            return 12 + block.items.length * 26;
        case 'table':
            return 40 + block.rows.length * 34;
        case 'heading':
            return 52;
        case 'rule':
            return 34;
        default:
            return 64;
    }
}

/**
 * A Markdown file as it reads, from the backend's tree: only the blocks on screen render, each
 * measured as it shows. Links lead to the document's headings, to the project's files and to the
 * browser; code blocks take the file's own syntax colors. Nothing in the file runs: every element
 * is one of ours, its text escaped by React.
 */
export default function MarkdownPreview({
    projectId,
    path,
    document,
    openOn,
    place,
    actions,
}: {
    projectId: string;
    path: string;
    document: MarkdownDocument;
    openOn: PreviewOpenOn | null;
    place: RefObject<PreviewPlace | null>;
    actions: PreviewActions;
}) {
    const i18n = useTranslation();
    const { codeLines } = useRepositorySettings();
    const { blocks } = document;
    const keys = useMemo(() => kindKeys(blocks), [blocks]);
    const ids = useMemo(() => blocksById(blocks), [blocks]);
    const scroll = useRef<HTMLDivElement>(null);
    // where it opens: the block of the line the code was read at, else of the element a link
    // named, its place first guessed, then the element itself once it shows
    const [opening] = useState(() => {
        if (openOn?.line) return { block: blockAtLine(blocks, openOn.line), anchor: null };
        const anchor = openOn?.anchor ?? null;
        return { block: anchor === null ? null : (ids.get(anchor) ?? null), anchor };
    });
    const virtualizer = useVirtualizer({
        count: blocks.length,
        getScrollElement: () => scroll.current,
        estimateSize: (index) => estimate(blocks[index]),
        getItemKey: (index) => keys[index],
        paddingStart: PADDING.start,
        paddingEnd: PADDING.end,
        overscan: 4,
        // read once, when the list first shows: the file read again keeps the scroll
        initialOffset: () =>
            opening.block === null
                ? 0
                : blocks
                      .slice(0, opening.block)
                      .reduce((offset, block) => offset + estimate(block), PADDING.start),
    });
    // an element asked for, once the block holding it has rendered
    const [sought, setSought] = useState<string | null>(opening.anchor);
    const goTo = (id: string) => {
        const index = ids.get(id);
        if (index === undefined) return;
        virtualizer.scrollToIndex(index, { align: 'start' });
        setSought(id);
    };
    useEffect(() => {
        if (!sought) return;
        const frame = requestAnimationFrame(() => {
            scroll.current
                ?.querySelector(`[id="${CSS.escape(sought)}"]`)
                ?.scrollIntoView({ block: 'start' });
            setSought(null);
        });
        return () => cancelAnimationFrame(frame);
    }, [sought]);

    useImperativeHandle(place, () => ({
        topLine: () => {
            const top = virtualizer.scrollOffset ?? 0;
            const first = virtualizer
                .getVirtualItems()
                .find((item) => item.end > top + PADDING.start);
            const block = first ? blocks[first.index] : blocks[0];
            return block && block.kind !== 'footnotes' ? block.line : null;
        },
    }));

    // every block on screen renders again with the list anyway: nothing to keep from one to the next
    const context: Context = { projectId, path, actions, goTo, wrap: codeLines === 'wrap' };

    return (
        <PreviewContext.Provider value={context}>
            <div
                ref={scroll}
                className="h-full overflow-y-auto bg-ui-surface-subtle [overflow-anchor:none]"
            >
                <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
                    {virtualizer.getVirtualItems().map((item) => (
                        <div
                            key={item.key}
                            ref={virtualizer.measureElement}
                            data-index={item.index}
                            className="absolute top-0 left-0 w-full px-8"
                            style={{ transform: `translateY(${item.start}px)` }}
                        >
                            <div className="mx-auto max-w-[860px] pb-4 text-[14.5px] leading-[1.65] text-ui-text">
                                <Block block={blocks[item.index]} />
                            </div>
                        </div>
                    ))}
                </div>
                {document.truncated ? (
                    <p className="pb-16 text-center text-sm text-ui-text-muted">
                        {i18n.t('view.fileCut')}
                    </p>
                ) : null}
            </div>
        </PreviewContext.Provider>
    );
}

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

const ALIGN_CLASS = { none: '', left: 'text-left', center: 'text-center', right: 'text-right' };

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

function Block({ block }: { block: MarkdownBlock }) {
    const i18n = useTranslation();
    switch (block.kind) {
        case 'paragraph':
        case 'plain':
            return (
                <p>
                    <Inlines content={block.content} />
                </p>
            );
        case 'heading': {
            const Tag = `h${Math.min(Math.max(block.level, 1), 6)}` as 'h1';
            return (
                <Tag id={block.id} className={HEADING_CLASS[block.level] ?? HEADING_CLASS[6]}>
                    <Inlines content={block.content} />
                </Tag>
            );
        }
        case 'quote': {
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
        case 'list': {
            const tasks = block.items.some((item) => item.task !== null);
            const items = block.items.map((item) => (
                <li key={item.line} className={item.task === null ? 'pl-1' : 'flex gap-2'}>
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
            ));
            const space = tasks ? 'list-none space-y-0.5' : 'space-y-0.5 pl-6';
            return block.start === null ? (
                <ul className={`${space} ${tasks ? '' : 'list-disc'}`}>{items}</ul>
            ) : (
                <ol start={block.start} className={`${space} list-decimal`}>
                    {items}
                </ol>
            );
        }
        case 'code':
            return <CodeBlock lines={block.lines} />;
        case 'table': {
            const table = tableCells(block.head, block.rows, block.align);
            return (
                <div className="overflow-x-auto">
                    <table className="border-collapse text-[0.95em]">
                        <thead>
                            <tr>
                                {table.head.map((cell) => (
                                    <th
                                        key={cell.key}
                                        className={`border border-ui-border bg-ui-surface px-3 py-1.5 font-semibold ${ALIGN_CLASS[cell.align]}`}
                                    >
                                        <Inlines content={cell.content} />
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {table.rows.map((row) => (
                                <tr key={row.key}>
                                    {row.cells.map((cell) => (
                                        <td
                                            key={cell.key}
                                            className={`border border-ui-border px-3 py-1.5 ${ALIGN_CLASS[cell.align]}`}
                                        >
                                            <Inlines content={cell.content} />
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            );
        }
        case 'rule':
            return <hr className="my-3 border-ui-border" />;
        case 'footnotes':
            return (
                <section className="mt-6 border-t border-ui-border pt-4 text-[0.9em] text-ui-text-dim">
                    <h2 className="mb-2 font-semibold text-ui-text-muted">
                        {i18n.t('preview.footnotes')}
                    </h2>
                    <ol className="list-decimal space-y-1 pl-6">
                        {block.notes.map((note) => (
                            <li key={note.number} id={footnoteId(note.number)}>
                                {/* a note of one paragraph, as most are, ends with its links back */}
                                {note.blocks.length === 1 && note.blocks[0].kind === 'paragraph' ? (
                                    <p>
                                        <Inlines content={note.blocks[0].content} />
                                        <BackLinks
                                            number={note.number}
                                            references={note.references}
                                        />
                                    </p>
                                ) : (
                                    <>
                                        <Blocks blocks={note.blocks} />
                                        <BackLinks
                                            number={note.number}
                                            references={note.references}
                                        />
                                    </>
                                )}
                            </li>
                        ))}
                    </ol>
                </section>
            );
    }
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

/** A code block: the file's own lines, colored as the file is, from where the code starts. */
function CodeBlock({ lines }: { lines: readonly MarkdownCodeLine[] }) {
    const { projectId, path, wrap } = usePreview();
    const sides = useMemo(() => fileSides(path), [path]);
    const asLines = useMemo<DiffLine[]>(
        () =>
            lines.map((line) => ({
                id: line.number,
                kind: 'context',
                text: line.text,
                oldNumber: line.number,
                newNumber: line.number,
            })),
        [lines],
    );
    const colorBlocks = useMemo(() => blocksOf(asLines, sides), [asLines, sides]);
    const colors = useSyntaxColors(projectId, sides, colorBlocks);
    return (
        <pre
            className={`rounded-lg bg-ui-surface px-4 py-3 font-mono text-[12.5px] leading-5 text-ui-syntax-text ${
                wrap ? 'whitespace-pre-wrap break-all' : 'overflow-x-auto'
            }`}
        >
            <code>
                {asLines.map((line, index) => (
                    <div key={line.id} className="min-h-5">
                        <CodeText
                            text={line.text}
                            spans={colors.colorsOf(line) ?? []}
                            from={lines[index].from}
                        />
                    </div>
                ))}
            </code>
        </pre>
    );
}

/** A line's text from `from`, in its colors; a carriage return at its end left out. */
function CodeText({ text, spans, from }: { text: string; spans: LineSpans; from: number }) {
    const end = text.endsWith('\r') ? text.length - 1 : text.length;
    let at = 0;
    return textParts(text.slice(0, end), spans, []).map((part) => {
        const start = at;
        at += part.text.length;
        if (at <= from) return null;
        const shown = start < from ? part.text.slice(from - start) : part.text;
        const tone = part.tone ? TONE_CLASS[part.tone] : undefined;
        return tone ? (
            <span key={start} className={tone}>
                {shown}
            </span>
        ) : (
            shown
        );
    });
}

function Inlines({ content }: { content: readonly MarkdownInline[] }) {
    const keys = kindKeys(content);
    return content.map((inline, index) => <InlineNode key={keys[index]} inline={inline} />);
}

function InlineNode({ inline }: { inline: MarkdownInline }): ReactNode {
    const { goTo } = usePreview();
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
        case 'footnoteRef': {
            const target = footnoteId(inline.number);
            return (
                <sup id={footnoteRefId(inline.number, inline.nth)}>
                    <a
                        href={`#${target}`}
                        className="px-0.5 text-ui-accent-text hover:underline"
                        onClick={(event) => {
                            event.preventDefault();
                            goTo(target);
                        }}
                    >
                        {inline.number}
                    </a>
                </sup>
            );
        }
    }
}

const LINK_CLASS = 'text-ui-accent-text underline-offset-2 hover:underline';

/** A click on a link: the app follows it, never the WebView, and no link around it. */
function follow(event: MouseEvent, action: () => void) {
    event.preventDefault();
    event.stopPropagation();
    if (event.button === 0) action();
}

/**
 * A link, by where it leads: only to a heading, a file of the project or a web or mail address,
 * through the app.
 */
function PreviewLink({
    target,
    title,
    children,
}: {
    target: MarkdownTarget | null;
    title: string | null;
    children: ReactNode;
}) {
    const { actions, goTo } = usePreview();
    const i18n = useTranslation();
    switch (target?.kind) {
        case 'anchor':
            return (
                <a
                    href={`#${target.id}`}
                    title={title ?? undefined}
                    className={LINK_CLASS}
                    onClick={(event) => follow(event, () => goTo(target.id))}
                    onAuxClick={(event) => event.preventDefault()}
                >
                    {children}
                </a>
            );
        case 'file':
            return (
                <a
                    href={target.path}
                    title={title ?? target.path}
                    className={LINK_CLASS}
                    onClick={(event) =>
                        follow(event, () => actions.openFile(target.path, target.anchor))
                    }
                    onAuxClick={(event) => event.preventDefault()}
                >
                    {children}
                </a>
            );
        case 'web':
            return (
                <a
                    href={target.url}
                    title={title ?? target.url}
                    className={LINK_CLASS}
                    onClick={(event) => follow(event, () => actions.openUrl(target.url))}
                    onAuxClick={(event) => event.preventDefault()}
                >
                    {children}
                </a>
            );
        case 'missing':
            return (
                <span
                    title={i18n.t('preview.notInProject', { path: target.path })}
                    className="text-ui-text-muted underline decoration-dotted underline-offset-2"
                >
                    {children}
                </span>
            );
        default:
            return <span title={title ?? undefined}>{children}</span>;
    }
}

/**
 * An image: a file of the project, loaded by the WebView from the app; one written into the file.
 * One on the web is never loaded: its description in place, a click opens it in the browser.
 */
function PreviewImage({
    target,
    alt,
    title,
}: {
    target: MarkdownTarget | null;
    alt: string;
    title: string | null;
}) {
    if (target?.kind === 'data') {
        return (
            <img
                src={target.url}
                alt={alt}
                title={title ?? undefined}
                className="inline max-w-full"
            />
        );
    }
    if (target?.kind === 'file') {
        return <ProjectImage path={target.path} alt={alt} title={title} />;
    }
    return <ImagePlaceholder target={target} alt={alt} title={title} />;
}

/** An image of the project; too large, or not an image after all, its description instead. */
function ProjectImage({ path, alt, title }: { path: string; alt: string; title: string | null }) {
    const { projectId } = usePreview();
    const image = useImageSource(projectId, path);
    const [failed, setFailed] = useState<string | null>(null);
    if (image.isPending) return null;
    if (!image.url || image.tooLarge || failed === image.url) {
        return <ImagePlaceholder target={null} alt={alt} title={title} />;
    }
    const url = image.url;
    return (
        <img
            src={url}
            alt={alt}
            title={title ?? undefined}
            className="inline max-w-full"
            onError={() => setFailed(url)}
        />
    );
}

/** An image not shown: its description, and for one on the web a click opening it. */
function ImagePlaceholder({
    target,
    alt,
    title,
}: {
    target: MarkdownTarget | null;
    alt: string;
    title: string | null;
}) {
    const { actions } = usePreview();
    const inLink = useContext(InLink);
    const i18n = useTranslation();
    const placeholder = (
        <span className="inline-flex items-center gap-1 rounded-md bg-ui-surface-hover px-1.5 py-0.5 align-middle text-[0.85em] text-ui-text-muted">
            <IconPhoto size={14} />
            {alt || title || i18n.t('preview.image')}
        </span>
    );
    // a badge inside a link: the link's click, one link
    if (target?.kind === 'web' && !inLink) {
        return (
            <a
                href={target.url}
                title={i18n.t('preview.remoteImage', { url: target.url })}
                onClick={(event) => follow(event, () => actions.openUrl(target.url))}
                onAuxClick={(event) => event.preventDefault()}
            >
                {placeholder}
            </a>
        );
    }
    return placeholder;
}
