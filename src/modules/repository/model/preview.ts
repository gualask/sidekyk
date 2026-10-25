import type { MarkdownAlign, MarkdownBlock, MarkdownInline } from './repository.types';

/** What a file shows as it reads, beside its text: by its extension, as the backend knows it. */
export type PreviewKind = 'markdown' | 'svg' | 'image';

const MARKDOWN = new Set(['md', 'markdown', 'mdown', 'mkd', 'mkdn']);
/** Those WKWebView, WebKitGTK and WebView2 all decode; SVG is text, and has its code too. */
const IMAGES = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico']);

/** Larger images are not shown (`MAX_IMAGE_BYTES` in the backend's `repository/limits.rs`). */
export const MAX_IMAGE_BYTES = 16 * 1024 * 1024;

/** A file's size as people read it: bytes, kB or MB (decimal, as file managers show them). */
export function fileSize(bytes: number, locale: string): string {
    const [value, unit] =
        bytes < 1000
            ? [bytes, 'byte']
            : bytes < 1_000_000
              ? [bytes / 1000, 'kilobyte']
              : [bytes / 1_000_000, 'megabyte'];
    return new Intl.NumberFormat(locale, {
        style: 'unit',
        unit,
        unitDisplay: 'short',
        maximumFractionDigits: unit === 'byte' ? 0 : 1,
    }).format(value);
}

/** The preview a file has, if any. */
export function previewKind(path: string): PreviewKind | null {
    const name = path.slice(path.lastIndexOf('/') + 1);
    const dot = name.lastIndexOf('.');
    if (dot <= 0) return null;
    const extension = name.slice(dot + 1).toLowerCase();
    if (MARKDOWN.has(extension)) return 'markdown';
    if (extension === 'svg') return 'svg';
    return IMAGES.has(extension) ? 'image' : null;
}

/** Whether a file shows as it reads. */
export function hasPreview(path: string): boolean {
    return previewKind(path) !== null;
}

/** Whether a file shows both as it reads and as its text: the switch "Code | Preview". */
export function hasCodeAndPreview(path: string): boolean {
    const kind = previewKind(path);
    return kind === 'markdown' || kind === 'svg';
}

/**
 * Each node's key: its kind and how many nodes of that kind come before it. A block keeps its key,
 * and so its element, when blocks of other kinds change above it, as an agent writes.
 */
export function kindKeys(nodes: readonly { kind: string }[]): string[] {
    const seen = new Map<string, number>();
    return nodes.map((node) => {
        const count = seen.get(node.kind) ?? 0;
        seen.set(node.kind, count + 1);
        return `${node.kind}:${count}`;
    });
}

/** A table's cell: its content and alignment, keyed by its column. */
export interface TableCell {
    key: string;
    content: MarkdownInline[];
    align: MarkdownAlign;
}

/**
 * A table's head and rows as cells keyed by their column, rows by their place: a table's columns
 * never move, and its rows are the file's, in order.
 */
export function tableCells(
    head: readonly MarkdownInline[][],
    rows: readonly MarkdownInline[][][],
    align: readonly MarkdownAlign[],
): { head: TableCell[]; rows: { key: string; cells: TableCell[] }[] } {
    const cells = (row: readonly MarkdownInline[][]) =>
        row.map((content, column) => ({
            key: `column:${column}`,
            content,
            align: align[column] ?? 'none',
        }));
    return {
        head: cells(head),
        rows: rows.map((row, place) => ({ key: `row:${place}`, cells: cells(row) })),
    };
}

/**
 * The block that holds a line of the file: the last one starting at or before it. The footnotes,
 * gathered at the end, start where their first was written, so they are left out.
 */
export function blockAtLine(blocks: readonly MarkdownBlock[], line: number): number {
    let found = 0;
    blocks.forEach((block, index) => {
        if (block.kind !== 'footnotes' && block.line <= line) found = index;
    });
    return found;
}

/** The footnote's element id, and that of each reference to it. */
export function footnoteId(number: number): string {
    return `user-content-fn-${number}`;
}

export function footnoteRefId(number: number, nth: number): string {
    return nth === 1 ? `user-content-fnref-${number}` : `user-content-fnref-${number}-${nth}`;
}

/** The top-level block holding each element id a link may lead to: headings and footnotes. */
export function blocksById(blocks: readonly MarkdownBlock[]): Map<string, number> {
    const ids = new Map<string, number>();
    const visit = (block: MarkdownBlock, index: number) => {
        switch (block.kind) {
            case 'heading':
                ids.set(block.id, index);
                inlinesOf(block.content, index);
                break;
            case 'paragraph':
            case 'plain':
                inlinesOf(block.content, index);
                break;
            case 'quote':
                for (const inner of block.blocks) visit(inner, index);
                break;
            case 'list':
                for (const item of block.items)
                    for (const inner of item.blocks) visit(inner, index);
                break;
            case 'table':
                for (const cell of [...block.head, ...block.rows.flat()]) inlinesOf(cell, index);
                break;
            case 'footnotes':
                for (const note of block.notes) {
                    ids.set(footnoteId(note.number), index);
                    for (const inner of note.blocks) visit(inner, index);
                }
                break;
            default:
                break;
        }
    };
    const inlinesOf = (content: readonly MarkdownInline[], index: number) => {
        for (const inline of content) {
            if (inline.kind === 'footnoteRef') {
                ids.set(footnoteRefId(inline.number, inline.nth), index);
            } else if ('content' in inline) inlinesOf(inline.content, index);
        }
    };
    blocks.forEach(visit);
    return ids;
}
