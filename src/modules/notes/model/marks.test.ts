import { describe, expect, it } from 'vitest';
import {
    inImage,
    isInLabel,
    labelInside,
    markAt,
    markHistory,
    markShape,
    markSize,
    marksBesides,
    nextLetter,
    redone,
    sameMarks,
    tailHandle,
    undone,
    withMarkText,
    withStep,
} from './marks';
import type { Mark } from './notes.types';

/** Every character 10 px wide. */
const measure = (text: string) => text.length * 10;

const mark = (text: string, tail: Mark['tail'] = null, x = 100, y = 100): Mark => ({
    x,
    y,
    text,
    tail,
});

describe('markSize', () => {
    it('follows the longest side within bounds', () => {
        expect(markSize(1200, 800)).toBe(25);
        expect(markSize(300, 200)).toBe(12);
        expect(markSize(5120, 2880)).toBe(64);
    });
});

describe('markShape', () => {
    it('is a circle around one letter and a pill around a text', () => {
        expect(markShape(mark('A'), 20, measure).label).toEqual({
            x: 84,
            y: 84,
            width: 32,
            height: 32,
        });
        const pill = markShape(mark('too wide'), 20, measure).label;
        expect(pill.width).toBe(100);
        expect(pill.x).toBe(50);
    });

    it('is a dot without text', () => {
        const { label } = markShape(mark('', { x: 200, y: 100 }), 20, measure);
        expect(label.width).toBe(label.height);
        expect(label.width).toBeLessThan(20);
    });

    it('ends its tail in a head pointing at the spot', () => {
        const { tail } = markShape(mark('A', { x: 200, y: 100 }), 20, measure);
        expect(tail?.from).toEqual({ x: 100, y: 100 });
        expect(tail?.to).toEqual({ x: 182, y: 100 });
        expect(tail?.head[0]).toEqual({ x: 200, y: 100 });
        expect(tail?.head[1]).toEqual({ x: 182, y: 109 });
        expect(tail?.head[2]).toEqual({ x: 182, y: 91 });
    });

    it('has no tail pointing at its own middle', () => {
        expect(markShape(mark('A', { x: 100, y: 100 }), 20, measure).tail).toBeNull();
    });
});

describe('markAt', () => {
    const shapes = [
        markShape(mark('A', { x: 300, y: 100 }), 20, measure),
        markShape(mark('B', null, 110, 100), 20, measure),
    ];

    it('finds the topmost label, then a tail', () => {
        expect(markAt(shapes, { x: 105, y: 100 }, 0)).toBe(1);
        expect(markAt(shapes, { x: 250, y: 102 }, 0)).toBe(0);
        expect(markAt(shapes, { x: 250, y: 140 }, 0)).toBe(-1);
        expect(markAt(shapes, { x: 250, y: 140 }, 40)).toBe(0);
    });

    it('tells a point inside a label', () => {
        expect(isInLabel(shapes[1], { x: 110, y: 100 })).toBe(true);
        expect(isInLabel(shapes[1], { x: 200, y: 100 })).toBe(false);
    });
});

describe('tailHandle', () => {
    it('is the tail tip, or the right of a label without one', () => {
        const tip = { x: 300, y: 50 };
        const withTail = mark('A', tip);
        expect(tailHandle(markShape(withTail, 20, measure), withTail)).toEqual(tip);
        const plain = mark('A');
        expect(tailHandle(markShape(plain, 20, measure), plain)).toEqual({ x: 116, y: 100 });
    });
});

describe('nextLetter', () => {
    it('comes after the highest letter placed, never back into a gap', () => {
        expect(nextLetter([])).toBe('A');
        expect(nextLetter([mark('A'), mark('C')])).toBe('D');
        expect(nextLetter([mark('a text'), mark(' B ')])).toBe('C');
    });

    it('takes the first free letter past Z', () => {
        expect(nextLetter([mark('Z'), mark('A')])).toBe('B');
        const all = Array.from({ length: 26 }, (_, n) => mark(String.fromCharCode(65 + n)));
        expect(nextLetter(all)).toBe('A');
    });
});

describe('marksBesides', () => {
    it("gives the other images' marks, so a note's letters continue across its images", () => {
        const byImage = [[mark('A'), mark('B')], [], [mark('C')]];
        expect(marksBesides(byImage, 2).map((m) => m.text)).toEqual(['A', 'B']);
        // the second image's next letter, after the first's and the third's
        expect(nextLetter([...marksBesides(byImage, 1), ...byImage[1]])).toBe('D');
        expect(marksBesides([], 0)).toEqual([]);
    });
});

describe('inImage', () => {
    it('keeps a point inside the image, in whole pixels', () => {
        expect(inImage({ x: -4, y: 10.6 }, 100, 50)).toEqual({ x: 0, y: 11 });
        expect(inImage({ x: 140, y: 60 }, 100, 50)).toEqual({ x: 100, y: 50 });
    });
});

describe('sameMarks', () => {
    it('compares positions, texts and tails', () => {
        expect(sameMarks([mark('A')], [mark('A')])).toBe(true);
        expect(sameMarks([mark('A')], [mark('B')])).toBe(false);
        expect(sameMarks([mark('A')], [mark('A', { x: 1, y: 1 })])).toBe(false);
        expect(sameMarks([mark('A')], [])).toBe(false);
    });
});

describe('withMarkText', () => {
    it('keeps a text trimmed, and a mark without text only with a tail', () => {
        const marks = [mark('A'), mark('B', { x: 1, y: 1 })];
        expect(withMarkText(marks, 0, ' manca il padding ')[0].text).toBe('manca il padding');
        expect(withMarkText(marks, 0, '  ')).toEqual([marks[1]]);
        expect(withMarkText(marks, 1, '')[1]).toEqual({ ...marks[1], text: '' });
        expect(withMarkText(marks, 5, 'x')).toEqual(marks);
    });
});

describe('mark history', () => {
    it('steps, undoes and redoes; a step that changes nothing is none', () => {
        const a = [mark('A')];
        const ab = [mark('A'), mark('B')];
        let history = withStep(withStep(markHistory([]), a), ab);
        expect(withStep(history, [mark('A'), mark('B')])).toBe(history);
        history = undone(history);
        expect(history.present).toEqual(a);
        history = undone(undone(history));
        expect(history.present).toEqual([]);
        history = redone(history);
        expect(history.present).toEqual(a);
        // a new step forgets what could be redone
        history = withStep(history, [mark('C')]);
        expect(redone(history)).toBe(history);
    });
});

describe('labelInside', () => {
    it('moves a label cut by an edge inside, its tail where it points', () => {
        const atEdge = mark('A', { x: 50, y: 50 }, 5, 199);
        const inside = labelInside(atEdge, markShape(atEdge, 20, measure), 300, 200);
        expect(inside).toEqual({ ...atEdge, x: 16, y: 184 });
        const whole = mark('A');
        expect(labelInside(whole, markShape(whole, 20, measure), 300, 200)).toBe(whole);
    });

    it('centers a label wider than the image', () => {
        const wide = mark('a long text', null, 3, 10);
        expect(labelInside(wide, markShape(wide, 20, measure), 60, 200).x).toBe(30);
    });
});
