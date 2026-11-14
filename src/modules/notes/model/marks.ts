import type { Mark, MarkPoint } from './notes.types';

/**
 * Marks' geometry, in the image's pixels: the same for the editor, which draws them over the
 * image fitted, and for the PNG drawn at the image's size, so what is copied is what was seen.
 */

/** A label's font size: from the image's longest side, readable once the image is fitted. */
export function markSize(width: number, height: number): number {
    return Math.min(64, Math.max(12, Math.round(Math.max(width, height) / 48)));
}

/** How wide a text is at `size`, as the canvas that draws it measures. */
export type MeasureText = (text: string) => number;

export interface MarkShape {
    /** The label: a pill around its text, a circle around one letter, a dot without text. */
    label: { x: number; y: number; width: number; height: number };
    /** From the label's middle to the base of the head, then the head's three corners. */
    tail: { from: MarkPoint; to: MarkPoint; head: [MarkPoint, MarkPoint, MarkPoint] } | null;
    /** The tail's width. */
    line: number;
}

/** How a mark is drawn, at a font size of `size`. */
export function markShape(mark: Mark, size: number, measure: MeasureText): MarkShape {
    const text = mark.text.trim();
    const height = text === '' ? size * 0.7 : size * 1.6;
    const width = text === '' ? height : Math.max(height, measure(text) + size);
    const label = { x: mark.x - width / 2, y: mark.y - height / 2, width, height };
    const line = Math.max(2, size * 0.16);
    return { label, tail: markTail(mark, size), line };
}

/** A mark's tail to its tip, with the head's corners: none without a tip, or on the mark itself. */
function markTail(mark: Mark, size: number): MarkShape['tail'] {
    const tip = mark.tail;
    if (!tip) return null;
    const dx = tip.x - mark.x;
    const dy = tip.y - mark.y;
    const length = Math.hypot(dx, dy);
    if (length === 0) return null;
    const ux = dx / length;
    const uy = dy / length;
    const headLength = Math.min(size * 0.9, length);
    const half = size * 0.45;
    const base = { x: tip.x - ux * headLength, y: tip.y - uy * headLength };
    return {
        from: { x: mark.x, y: mark.y },
        to: base,
        head: [
            { x: tip.x, y: tip.y },
            { x: base.x - uy * half, y: base.y + ux * half },
            { x: base.x + uy * half, y: base.y - ux * half },
        ],
    };
}

/** Whether `point` is on a shape: its label, or near its tail (within `slack`). */
function isOnShape(shape: MarkShape, point: MarkPoint, slack: number): boolean {
    const { label, tail } = shape;
    if (
        point.x >= label.x - slack &&
        point.x <= label.x + label.width + slack &&
        point.y >= label.y - slack &&
        point.y <= label.y + label.height + slack
    ) {
        return true;
    }
    return tail !== null && distanceToSegment(point, tail.from, tail.head[0]) <= shape.line + slack;
}

/** Whether `point` is inside a label, where a tail dropped goes away. */
export function isInLabel(shape: MarkShape, point: MarkPoint): boolean {
    const { label } = shape;
    return (
        point.x >= label.x &&
        point.x <= label.x + label.width &&
        point.y >= label.y &&
        point.y <= label.y + label.height
    );
}

function distanceToSegment(point: MarkPoint, a: MarkPoint, b: MarkPoint): number {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const squared = dx * dx + dy * dy;
    const t =
        squared === 0
            ? 0
            : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / squared));
    return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

/** The topmost mark at `point` (the last placed), or -1. */
export function markAt(shapes: readonly MarkShape[], point: MarkPoint, slack: number): number {
    for (let index = shapes.length - 1; index >= 0; index -= 1) {
        if (isOnShape(shapes[index], point, slack)) return index;
    }
    return -1;
}

/**
 * Where a new tail starts from: the right of the label, where the editor's handle pulls one out.
 */
export function tailHandle(shape: MarkShape, mark: Mark): MarkPoint {
    return mark.tail ?? { x: shape.label.x + shape.label.width, y: mark.y };
}

const A = 'A'.charCodeAt(0);
const Z = 'Z'.charCodeAt(0);

/**
 * The letter a new label takes: the one after the highest placed, so a letter the message names
 * never points at another mark (B deleted, D comes after C); past Z, the first free one.
 */
export function nextLetter(marks: readonly Mark[]): string {
    const used = new Set(
        marks.map((mark) => mark.text.trim()).filter((text) => /^[A-Z]$/.test(text)),
    );
    const highest = Math.max(A - 1, ...[...used].map((letter) => letter.charCodeAt(0)));
    if (highest < Z) return String.fromCharCode(highest + 1);
    for (let code = A; code <= Z; code += 1) {
        const letter = String.fromCharCode(code);
        if (!used.has(letter)) return letter;
    }
    return 'A';
}

/**
 * The marks of a note's images, `byImage` in their order, but the one at `index`: a letter placed
 * on that one comes after theirs, so the note's letters never repeat across its images. Each
 * caller gives the marks as it holds them: a note's as kept, a draft's as being marked.
 */
export function marksBesides(byImage: readonly (readonly Mark[])[], index: number): Mark[] {
    return byImage.flatMap((marks, at) => (at === index ? [] : marks));
}

/** A point kept inside an image of `width` x `height`, in whole pixels, as the backend takes it. */
export function inImage(point: MarkPoint, width: number, height: number): MarkPoint {
    return {
        x: Math.round(Math.min(width, Math.max(0, point.x))),
        y: Math.round(Math.min(height, Math.max(0, point.y))),
    };
}

export function withMark(marks: readonly Mark[], index: number, mark: Mark): Mark[] {
    return marks.map((m, at) => (at === index ? mark : m));
}

export function withoutMark(marks: readonly Mark[], index: number): Mark[] {
    return marks.filter((_, at) => at !== index);
}

/** The marks with a mark's text written, trimmed: a mark left with neither text nor tail goes. */
export function withMarkText(marks: readonly Mark[], index: number, text: string): Mark[] {
    const mark = marks[index];
    if (!mark) return [...marks];
    const kept = text.trim();
    return kept === '' && !mark.tail
        ? withoutMark(marks, index)
        : withMark(marks, index, { ...mark, text: kept });
}

/**
 * A mark moved just enough for its label to be whole inside an image of `width` x `height`, so
 * the PNG never cuts it; its tail's tip stays where it points.
 */
export function labelInside(mark: Mark, shape: MarkShape, width: number, height: number): Mark {
    const inside = (middle: number, half: number, side: number) =>
        half * 2 >= side ? side / 2 : Math.min(side - half, Math.max(half, middle));
    const x = Math.round(inside(mark.x, shape.label.width / 2, width));
    const y = Math.round(inside(mark.y, shape.label.height / 2, height));
    return x === mark.x && y === mark.y ? mark : { ...mark, x, y };
}

/** Whether two lists of marks are the same: nothing to draw again. */
export function sameMarks(a: readonly Mark[], b: readonly Mark[]): boolean {
    return (
        a.length === b.length &&
        a.every((mark, index) => {
            const other = b[index];
            return (
                mark.x === other.x &&
                mark.y === other.y &&
                mark.text === other.text &&
                mark.tail?.x === other.tail?.x &&
                mark.tail?.y === other.tail?.y
            );
        })
    );
}

/**
 * The most marks an image takes, and the longest text of one: the backend's limits
 * (`src-tauri/crates/core/src/modules/notes/images.rs`, `check_marks`).
 */
export const MAX_MARKS = 100;
export const MAX_MARK_TEXT = 200;

/** An editor's marks, with the steps before and after them to undo and redo. */
export interface MarkHistory {
    past: Mark[][];
    present: Mark[];
    future: Mark[][];
}

export function markHistory(marks: Mark[]): MarkHistory {
    return { past: [], present: marks, future: [] };
}

/** The history with `next` as a new step; the same when nothing changed. */
export function withStep(history: MarkHistory, next: Mark[]): MarkHistory {
    return sameMarks(next, history.present)
        ? history
        : { past: [...history.past, history.present], present: next, future: [] };
}

export function undone(history: MarkHistory): MarkHistory {
    const previous = history.past.at(-1);
    return previous
        ? {
              past: history.past.slice(0, -1),
              present: previous,
              future: [history.present, ...history.future],
          }
        : history;
}

export function redone(history: MarkHistory): MarkHistory {
    const next = history.future[0];
    return next
        ? {
              past: [...history.past, history.present],
              present: next,
              future: history.future.slice(1),
          }
        : history;
}
