import { Fragment, memo } from 'react';
import { useTranslation } from '@/shared/i18n';
import type { DiffHunk, DiffLine } from '../model/diff-parser';
import type { LineBreaks } from '../model/soft-wrap';
import { type LineSpans, textParts } from '../model/syntax';
import {
    BRACKET_WIDTH,
    LINE_ROW_HEIGHT,
    NUMBER_WIDTH,
    SIGN_WIDTH,
    TEXT_PADDING_LEFT,
    TEXT_PADDING_RIGHT,
} from './diff-layout';
import { TONE_CLASS } from './syntax-tones';

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
    const { t } = useTranslation();
    return (
        <button
            type="button"
            onClick={onCopy}
            title={t('view.copyHunk')}
            className={`flex h-6 w-full cursor-pointer items-center gap-3 bg-ui-diff-hunk-bg px-4 text-left text-ui-diff-hunk-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-accent-muted focus-visible:ring-inset ${
                first ? '' : 'border-t border-ui-border'
            }`}
        >
            {/* cut at the edge while lines wrap; otherwise the list is as wide as the widest */}
            <span className="min-w-0 overflow-hidden text-ellipsis whitespace-pre">
                {hunk.header}
            </span>
        </button>
    );
}

/** Where the text looked for is in a line (UTF-16 offsets), and which of them is being read. */
export interface LineFound {
    ranges: readonly (readonly [start: number, end: number])[];
    /** The one being read, if it is in this line. */
    current: number | null;
}

/** A line's text in its colors, with the text looked for marked over them, on its rows. */
function LineText({
    text,
    colors,
    found,
    wrap,
}: {
    text: string;
    colors: LineSpans;
    found: LineFound | undefined;
    wrap: LineBreaks | undefined;
}) {
    const indent = ' '.repeat(wrap?.indent ?? 0);
    let at = 0;
    return textParts(text, colors, found?.ranges ?? [], wrap?.breaks).map((part) => {
        const key = at;
        at += part.text.length;
        const tone = part.tone ? TONE_CLASS[part.tone] : undefined;
        const shown =
            part.found === null ? (
                tone ? (
                    <span className={tone}>{part.text}</span>
                ) : (
                    part.text
                )
            ) : (
                <mark
                    className={`rounded-[2px] ${tone ?? 'text-current'} ${
                        part.found === found?.current ? 'bg-ui-find-current' : 'bg-ui-find-match'
                    }`}
                >
                    {part.text}
                </mark>
            );
        return (
            <Fragment key={key}>
                {part.breakBefore ? <span className="soft-break" data-indent={indent} /> : null}
                {shown}
            </Fragment>
        );
    });
}

/**
 * A line, its number and sign in the gutter (`data-part="gutter"`, which a click turns into a
 * copy of the whole hunk): its number in the file now, or for a removed line where it was, as a
 * copy names it. Its text in its syntax colors, if read; `found` marks the text looked for in it.
 * While long lines wrap, `wrap` says where its rows start; the gutter runs along all of them.
 * Rendered again only when what it shows changes: a scroll leaves the rows already on screen as
 * they are, and a new width the lines that fit it (they share one `LineBreaks`).
 */
export const DiffLineRow = memo(function DiffLineRow({
    line,
    colors,
    found,
    wrap,
}: {
    line: DiffLine;
    colors?: LineSpans | undefined;
    found?: LineFound | undefined;
    wrap?: LineBreaks | undefined;
}) {
    const gutter = `shrink-0 select-none ${GUTTER_TONE[line.kind]}`;
    const rows = (wrap?.breaks.length ?? 0) + 1;
    return (
        <div
            className={`relative flex cursor-pointer leading-5 ${ROW_TONE[line.kind]}`}
            style={{ height: rows * LINE_ROW_HEIGHT }}
        >
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
            {/* wrapped, the spaces hanging past the edge are cut, not scrolled to */}
            <span
                className={`flex-1 whitespace-pre ${wrap ? 'min-w-0 overflow-hidden' : ''} ${
                    line.kind === 'note' ? '' : 'text-ui-syntax-text'
                }`}
                style={{ paddingLeft: TEXT_PADDING_LEFT, paddingRight: TEXT_PADDING_RIGHT }}
            >
                {colors || found || rows > 1 ? (
                    <LineText text={line.text} colors={colors ?? []} found={found} wrap={wrap} />
                ) : (
                    line.text
                )}
            </span>
        </div>
    );
});
