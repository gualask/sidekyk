import type { PointerEvent } from 'react';
import { trackDrag } from '@/shared/ui/pointer-drag';
import type { Mark } from '../../model/notes.types';

/** In CSS pixels: how far a press moves before it drags. */
const CLICK = 4;

/**
 * Follows a drag of the marks from `press`: past a click, each move shows the marks `move` gives
 * as the draft; at the release the draft goes and `end` gets the last marks shown, null for a
 * click.
 */
export function draftDrag(
    press: PointerEvent<HTMLCanvasElement>,
    setDraft: (marks: Mark[] | null) => void,
    move: (pointer: globalThis.PointerEvent) => Mark[],
    end: (latest: Mark[] | null) => void,
) {
    let latest: Mark[] | null = null;
    const far = (pointer: globalThis.PointerEvent) =>
        Math.hypot(pointer.clientX - press.clientX, pointer.clientY - press.clientY) > CLICK;
    trackDrag(
        press,
        (pointer) => {
            if (!far(pointer) && !latest) return;
            latest = move(pointer);
            setDraft(latest);
        },
        () => {
            setDraft(null);
            end(latest);
        },
    );
}
