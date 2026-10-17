import type { PointerEvent } from 'react';

/**
 * Follows a drag from a pointer pressed on `event`'s element, which captures the pointer: `move`
 * with each position, `end` when the button comes up (or the system cancels), whether it moved.
 * Only the main button drags.
 */
export function trackDrag(
    event: PointerEvent<HTMLElement>,
    move: (pointer: globalThis.PointerEvent) => void,
    end: (moved: boolean) => void,
) {
    if (event.button !== 0) return;
    event.preventDefault();
    const bar = event.currentTarget;
    bar.setPointerCapture(event.pointerId);
    let moved = false;
    const onMove = (pointer: globalThis.PointerEvent) => {
        moved = true;
        move(pointer);
    };
    const onEnd = () => {
        bar.removeEventListener('pointermove', onMove);
        bar.removeEventListener('pointerup', onEnd);
        bar.removeEventListener('pointercancel', onEnd);
        end(moved);
    };
    bar.addEventListener('pointermove', onMove);
    bar.addEventListener('pointerup', onEnd);
    bar.addEventListener('pointercancel', onEnd);
}
