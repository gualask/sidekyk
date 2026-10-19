import { useLayoutEffect, useMemo, useState } from 'react';
import type { DiffRow } from '../model/diff-rows';
import { type GlyphWidth, type LineWrapper, lineWrapper, measureLines } from '../model/soft-wrap';
import { CODE_TEXT, LINE_CHROME_WIDTH } from './diff-layout';

/** The fewest columns a wrapped row holds, however narrow the viewer. */
const MIN_COLUMNS = 16;

/** The viewer's font, as wrapping measures it: a column's width, and any character's in columns. */
interface CodeGlyphs {
    column: number;
    widthOf: GlyphWidth;
}

const glyphsByFont = new Map<string, CodeGlyphs>();

/**
 * The glyphs of the font the lines show in, read from an element styled as they are. A character
 * other than ASCII is measured on a canvas the first time it is met, as the DOM lays it out (CJK
 * falls back to a font of its own, about 1.5 columns), and kept for the session. Null without a
 * canvas to measure on.
 */
function codeGlyphs(): CodeGlyphs | null {
    const probe = document.createElement('span');
    probe.className = CODE_TEXT;
    document.body.appendChild(probe);
    const style = getComputedStyle(probe);
    const font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    probe.remove();
    const known = glyphsByFont.get(font);
    if (known) return known;
    const context = document.createElement('canvas').getContext('2d');
    if (!context) return null;
    context.font = font;
    const column = context.measureText('0'.repeat(64)).width / 64;
    if (!(column > 0)) return null;
    const widths = new Map<number, number>();
    const glyphs = {
        column,
        widthOf: (point: number) => {
            let width = widths.get(point);
            if (width === undefined) {
                width = context.measureText(String.fromCodePoint(point)).width / column;
                widths.set(point, width);
            }
            return width;
        },
    };
    glyphsByFont.set(font, glyphs);
    return glyphs;
}

/** How many columns of text a row of the viewer holds, beside the gutter and padding. */
function columnsIn(element: HTMLElement, column: number): number {
    return Math.max(MIN_COLUMNS, Math.floor((element.clientWidth - LINE_CHROME_WIDTH) / column));
}

/**
 * While `enabled`, how `rows` wrap in `scrollElement`: measured before the first frame shows (a
 * layout effect), kept as the element resizes, a new wrapper only when a column comes or goes, so
 * dragging a sidebar lays the rows out again only that often. Each line is measured once per text;
 * a new width wraps again only the lines wider than it. Null while lines do not wrap.
 */
export function useLineWrapper(
    scrollElement: HTMLElement | null,
    rows: readonly DiffRow[],
    enabled: boolean,
): LineWrapper | null {
    const [fit, setFit] = useState<{ glyphs: CodeGlyphs; columns: number } | null>(null);
    useLayoutEffect(() => {
        const glyphs = scrollElement && enabled ? codeGlyphs() : null;
        if (!scrollElement || !glyphs) {
            setFit(null);
            return;
        }
        const measure = () => {
            const columns = columnsIn(scrollElement, glyphs.column);
            setFit((current) =>
                current?.glyphs === glyphs && current.columns === columns
                    ? current
                    : { glyphs, columns },
            );
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(scrollElement);
        return () => observer.disconnect();
    }, [scrollElement, enabled]);
    const glyphs = fit?.glyphs ?? null;
    const measured = useMemo(() => {
        if (!glyphs) return null;
        const texts = rows.map((row) => (row.kind === 'line' ? row.line.text : ''));
        return { texts, measures: measureLines(texts, glyphs.widthOf) };
    }, [rows, glyphs]);
    const columns = fit?.columns ?? null;
    return useMemo(
        () =>
            measured && glyphs && columns !== null
                ? lineWrapper(measured.texts, measured.measures, columns, glyphs.widthOf)
                : null,
        [measured, glyphs, columns],
    );
}
