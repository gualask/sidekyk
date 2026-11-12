import { type RefObject, useLayoutEffect, useMemo } from 'react';
import { tailHandle, withMark } from '../../../model/marks';
import type { Mark } from '../../../model/notes.types';
import type { Size } from '../use-room';
import { drawMarks, type MarkInk } from './draw-marks';
import { drawSelection, selectionInk } from './draw-selection';

/** What the canvas shows: the marks, the one selected, the one whose text is being written. */
interface MarksView {
    marks: Mark[];
    selected: number | null;
    editing: { index: number } | null;
}

/** Draws `view` on `canvas` at `scale` (none at 0), `shown` CSS pixels large, the image `image`. */
export function useMarksDrawing(
    canvas: RefObject<HTMLCanvasElement | null>,
    scale: number,
    shown: Size,
    image: Size,
    ink: MarkInk,
    { marks, selected, editing }: MarksView,
) {
    const selection = useMemo(selectionInk, []);
    const { width: shownWidth, height: shownHeight } = shown;
    const { width, height } = image;
    useLayoutEffect(() => {
        const element = canvas.current;
        const context = element?.getContext('2d');
        if (!element || !context || scale === 0) return;
        const ratio = window.devicePixelRatio || 1;
        fitCanvas(element, Math.round(shownWidth * ratio), Math.round(shownHeight * ratio));
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.clearRect(0, 0, element.width, element.height);
        context.setTransform(ratio * scale, 0, 0, ratio * scale, 0, 0);
        const shapes = drawMarks(context, drawnMarks(marks, editing), width, height, ink);
        const shape = selected === null || editing ? undefined : shapes[selected];
        const mark = marks[selected ?? -1];
        if (shape && mark) {
            drawSelection(context, shape, tailHandle(shape, mark), scale, selection);
        }
    }, [
        canvas,
        marks,
        selected,
        editing,
        scale,
        shownWidth,
        shownHeight,
        width,
        height,
        ink,
        selection,
    ]);
}

/** Sizes the canvas's pixels, only when they change: setting them clears it. */
function fitCanvas(element: HTMLCanvasElement, width: number, height: number) {
    if (element.width === width && element.height === height) return;
    element.width = width;
    element.height = height;
}

/** The marks as the canvas draws them: the label being written without its text, the field's. */
function drawnMarks(marks: Mark[], editing: MarksView['editing']): Mark[] {
    if (!editing) return marks;
    return withMark(marks, editing.index, { ...marks[editing.index], text: '' });
}
