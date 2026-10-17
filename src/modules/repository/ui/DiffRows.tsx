import type { DiffHunk, DiffLine } from '../model/diff-parser';
import {
    BRACKET_WIDTH,
    NUMBER_WIDTH,
    SIGN_WIDTH,
    TEXT_PADDING_LEFT,
    TEXT_PADDING_RIGHT,
} from './diff-layout';

const ROW_TONE: Record<DiffLine['kind'], string> = {
    context: '',
    add: 'bg-ui-diff-add-bg',
    del: 'bg-ui-diff-del-bg',
    note: 'text-ui-text-muted italic',
};

const GUTTER_TONE: Record<DiffLine['kind'], string> = {
    context: 'text-ui-text-muted',
    add: 'bg-ui-diff-add-gutter text-ui-diff-add-mark',
    del: 'bg-ui-diff-del-gutter text-ui-diff-del-mark',
    note: 'text-ui-text-muted',
};

const SIGN: Record<DiffLine['kind'], string> = { context: '', add: '+', del: '−', note: '' };

/** A hunk's `@@` header: a click copies the hunk, as a click on its lines' numbers does. */
export function HunkHeaderRow({
    hunk,
    first,
    onCopy,
}: {
    hunk: DiffHunk;
    first: boolean;
    onCopy: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onCopy}
            title="Copy this hunk"
            className={`flex h-6 w-full cursor-pointer items-center gap-3 bg-ui-diff-hunk-bg px-4 text-left text-ui-diff-hunk-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-accent-muted focus-visible:ring-inset ${
                first ? '' : 'border-t border-ui-border'
            }`}
        >
            <span className="whitespace-pre">{hunk.header}</span>
        </button>
    );
}

/** Where the text looked for is in a line (UTF-16 offsets), and which of them is being read. */
export interface LineFound {
    ranges: readonly (readonly [start: number, end: number])[];
    /** The one being read, if it is in this line. */
    current: number | null;
}

/** A line's text, with the text looked for marked in it. */
function FoundText({ text, found }: { text: string; found: LineFound }) {
    const parts = [];
    let at = 0;
    found.ranges.forEach(([start, end], index) => {
        if (start > at) parts.push(text.slice(at, start));
        parts.push(
            <mark
                key={start}
                className={`rounded-[2px] text-current ${
                    index === found.current ? 'bg-ui-find-current' : 'bg-ui-find-match'
                }`}
            >
                {text.slice(start, end)}
            </mark>,
        );
        at = end;
    });
    if (at < text.length) parts.push(text.slice(at));
    return parts;
}

/**
 * A line, its number and sign in the gutter (`data-part="gutter"`, which a click turns into a
 * copy of the whole hunk): its number in the file now, or for a removed line where it was, as a
 * copy names it. `found` marks the text looked for in it.
 */
export function DiffLineRow({ line, found }: { line: DiffLine; found?: LineFound }) {
    const gutter = `shrink-0 select-none ${GUTTER_TONE[line.kind]}`;
    return (
        <div className={`relative flex h-5 cursor-pointer leading-5 ${ROW_TONE[line.kind]}`}>
            <span data-part="gutter" className="flex shrink-0">
                {/* where a hunk's bracket goes */}
                <span className={gutter} style={{ width: BRACKET_WIDTH }} />
                {/* one column: the line in the file now, or where a removed line was */}
                <span
                    className={`px-2 text-right tabular-nums ${gutter}`}
                    style={{ width: NUMBER_WIDTH }}
                >
                    {(line.kind === 'del' ? line.oldNumber : line.newNumber) ?? ''}
                </span>
                <span className={`text-center ${gutter}`} style={{ width: SIGN_WIDTH }}>
                    {SIGN[line.kind]}
                </span>
            </span>
            <span
                className="flex-1 whitespace-pre"
                style={{ paddingLeft: TEXT_PADDING_LEFT, paddingRight: TEXT_PADDING_RIGHT }}
            >
                {found ? <FoundText text={line.text} found={found} /> : line.text}
            </span>
        </div>
    );
}
