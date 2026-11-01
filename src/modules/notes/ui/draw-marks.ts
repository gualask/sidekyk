import { type MarkShape, type MeasureText, markShape, markSize } from '../model/marks';
import type { Mark } from '../model/notes.types';

/**
 * Marks drawn on a canvas, in the image's pixels: the editor draws them over the image fitted,
 * the PNG a note keeps draws them over the image at its size, with this same code.
 */

/** The colors and the font of the marks: tokens the same in both themes, and the app's font. */
export interface MarkInk {
    fill: string;
    edge: string;
    family: string;
}

export function markInk(): MarkInk {
    const root = getComputedStyle(document.documentElement);
    return {
        fill: root.getPropertyValue('--ui-mark').trim(),
        edge: root.getPropertyValue('--ui-mark-text').trim(),
        family: getComputedStyle(document.body).fontFamily,
    };
}

export function markFont(size: number, family: string): string {
    return `700 ${size}px ${family}`;
}

let measuring: CanvasRenderingContext2D | null = null;

/** A label's text measured at `size`, off screen, as `drawMarks` measures it. */
export function textMeasure(size: number, ink: MarkInk): MeasureText {
    measuring ??= document.createElement('canvas').getContext('2d');
    if (!measuring) return (text) => text.length * size;
    return canvasMeasure(measuring, size, ink);
}

/** A canvas's measure of a label's text, its font set first. */
function canvasMeasure(context: CanvasRenderingContext2D, size: number, ink: MarkInk): MeasureText {
    context.font = markFont(size, ink.family);
    return (text) => context.measureText(text).width;
}

/** The marks of an image of `width` x `height` on `context`, its transform mapping its pixels. */
export function drawMarks(
    context: CanvasRenderingContext2D,
    marks: readonly Mark[],
    width: number,
    height: number,
    ink: MarkInk,
): MarkShape[] {
    const size = markSize(width, height);
    context.save();
    const measure = canvasMeasure(context, size, ink);
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.lineCap = 'round';
    context.lineJoin = 'round';
    const shapes = marks.map((mark) => {
        const shape = markShape(mark, size, measure);
        drawShape(context, shape, mark.text.trim(), size, ink);
        return shape;
    });
    context.restore();
    return shapes;
}

function drawShape(
    context: CanvasRenderingContext2D,
    shape: MarkShape,
    text: string,
    size: number,
    ink: MarkInk,
) {
    // an edge in the other color, so a mark reads over any pixels
    const edge = Math.max(1.5, size * 0.1);
    const { tail, label, line } = shape;
    if (tail) {
        const head = new Path2D();
        head.moveTo(tail.head[0].x, tail.head[0].y);
        head.lineTo(tail.head[1].x, tail.head[1].y);
        head.lineTo(tail.head[2].x, tail.head[2].y);
        head.closePath();
        const shaft = new Path2D();
        shaft.moveTo(tail.from.x, tail.from.y);
        shaft.lineTo(tail.to.x, tail.to.y);
        context.strokeStyle = ink.edge;
        context.lineWidth = line + edge * 2;
        context.stroke(shaft);
        context.lineWidth = edge * 2;
        context.stroke(head);
        context.strokeStyle = ink.fill;
        context.lineWidth = line;
        context.stroke(shaft);
        context.fillStyle = ink.fill;
        context.fill(head);
    }
    const radius = label.height / 2;
    const pill = new Path2D();
    pill.moveTo(label.x + radius, label.y);
    pill.lineTo(label.x + label.width - radius, label.y);
    pill.arc(label.x + label.width - radius, label.y + radius, radius, -Math.PI / 2, Math.PI / 2);
    pill.lineTo(label.x + radius, label.y + label.height);
    pill.arc(label.x + radius, label.y + radius, radius, Math.PI / 2, (Math.PI * 3) / 2);
    pill.closePath();
    context.fillStyle = ink.fill;
    context.fill(pill);
    context.strokeStyle = ink.edge;
    context.lineWidth = edge;
    context.stroke(pill);
    if (text !== '') {
        context.fillStyle = ink.edge;
        context.fillText(text, label.x + label.width / 2, label.y + radius + size * 0.05);
    }
}

/**
 * The PNG a marked image keeps: `image`, the image as given (as PNG, so its pixels are as the
 * backend reads them), with `marks` drawn over it at its size. The canvas is let go at once.
 */
export async function drawnPng(
    image: Blob,
    marks: readonly Mark[],
    width: number,
    height: number,
): Promise<Uint8Array<ArrayBuffer>> {
    const bitmap = await createImageBitmap(image);
    const canvas = document.createElement('canvas');
    try {
        if (bitmap.width !== width || bitmap.height !== height) {
            throw new Error(
                `the image is ${bitmap.width} x ${bitmap.height}, not ${width} x ${height}`,
            );
        }
        const ink = markInk();
        await document.fonts.load(markFont(markSize(width, height), ink.family));
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('no 2D canvas');
        context.drawImage(bitmap, 0, 0);
        drawMarks(context, marks, width, height, ink);
        const png = await new Promise<Blob>((resolve, reject) =>
            canvas.toBlob(
                (blob) => (blob ? resolve(blob) : reject(new Error('no PNG'))),
                'image/png',
            ),
        );
        return new Uint8Array(await png.arrayBuffer());
    } finally {
        bitmap.close();
        // a canvas holds its pixels until it is resized or collected
        canvas.width = 0;
        canvas.height = 0;
    }
}
