import type { MarkShape } from '../../../model/marks';
import type { MarkPoint } from '../../../model/notes.types';

/** The radius of a tail's handle, in CSS pixels. */
export const HANDLE = 6;

/** The selection's colors: the accent and the surface, read once. */
export function selectionInk(): { accent: string; surface: string } {
    const root = getComputedStyle(document.documentElement);
    return {
        accent: root.getPropertyValue('--ui-accent').trim(),
        surface: root.getPropertyValue('--ui-surface').trim(),
    };
}

/** The selected mark's outline and its tail's handle, in the accent, a CSS pixel wide. */
export function drawSelection(
    context: CanvasRenderingContext2D,
    shape: MarkShape,
    handle: MarkPoint,
    scale: number,
    { accent, surface }: ReturnType<typeof selectionInk>,
) {
    const pixel = 1 / scale;
    const { label } = shape;
    const gap = 3 * pixel;
    context.save();
    context.strokeStyle = accent;
    context.lineWidth = 1.5 * pixel;
    context.setLineDash([4 * pixel, 3 * pixel]);
    context.strokeRect(label.x - gap, label.y - gap, label.width + gap * 2, label.height + gap * 2);
    context.setLineDash([]);
    context.beginPath();
    context.arc(handle.x, handle.y, HANDLE * pixel, 0, Math.PI * 2);
    context.fillStyle = surface;
    context.fill();
    context.stroke();
    context.restore();
}
