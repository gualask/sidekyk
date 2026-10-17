import { type RefObject, useEffect, useEffectEvent, useState } from 'react';
import type { DiffRow } from '../model/diff-rows';
import type { Span } from './diff-layout';
import { sameTarget, type Target, targetAt } from './diff-target';

/** The row an element of the list belongs to (`data-row`), or -1. */
function rowIndexOf(node: Node | null): number {
    const element = node instanceof Element ? node : node?.parentElement;
    const row = element?.closest<HTMLElement>('[data-row]');
    return row ? Number(row.dataset.row) : -1;
}

/** The target under an element of the list. */
function targetOf(rows: readonly DiffRow[], node: EventTarget | null): Target | null {
    if (!(node instanceof Element)) return null;
    return targetAt(rows, rowIndexOf(node), node.closest('[data-part="gutter"]') !== null);
}

/** A selection's ends, to tell a new selection from the one already there. */
function selectionEnds(selection: Selection | null): string {
    if (!selection || selection.isCollapsed) return '';
    const { anchorNode, anchorOffset, focusNode, focusOffset } = selection;
    return `${rowIndexOf(anchorNode)}:${anchorOffset}:${rowIndexOf(focusNode)}:${focusOffset}`;
}

/**
 * The pointer over a diff's rows, listened to once on the list rather than on every row: what a
 * click would copy (`hovered`), a click (pressed and released on the same line or hunk), and text
 * selected with the mouse, taken when the button comes up, even outside the list. A click inside
 * a selection already there is a click: the browser clears it only after. A header is a button,
 * which copies on its own (and from the keyboard).
 */
export function useDiffPointer(
    listRef: RefObject<HTMLDivElement | null>,
    rows: readonly DiffRow[],
    on: {
        click: (target: Target) => void;
        select: (text: string, rows: Span) => void;
    },
): Target | null {
    const [hovered, setHovered] = useState<Target | null>(null);

    const move = useEffectEvent((event: PointerEvent) => {
        const target = targetOf(rows, event.target);
        setHovered((current) => (sameTarget(current, target) ? current : target));
    });
    const down = useEffectEvent((event: PointerEvent) => {
        const onButton = event.target instanceof Element && event.target.closest('button');
        return event.button === 0 && !onButton ? targetOf(rows, event.target) : undefined;
    });
    const up = useEffectEvent(
        (event: PointerEvent, pressed: Target | null, selectedBefore: string) => {
            const list = listRef.current;
            const selection = window.getSelection();
            const selected =
                list &&
                selection &&
                !selection.isCollapsed &&
                list.contains(selection.anchorNode) &&
                selectionEnds(selection) !== selectedBefore;
            if (selection && selected) {
                const text = selection.toString();
                const ends = [rowIndexOf(selection.anchorNode), rowIndexOf(selection.focusNode)];
                const first = Math.max(0, Math.min(...ends));
                if (text) on.select(text, { first, last: Math.max(...ends) });
                return;
            }
            if (pressed && sameTarget(pressed, targetOf(rows, event.target))) on.click(pressed);
        },
    );

    useEffect(() => {
        const list = listRef.current;
        if (!list) return;
        let pressed: Target | null | undefined;
        let selectedBefore = '';
        const onDown = (event: PointerEvent) => {
            pressed = down(event);
            selectedBefore = selectionEnds(window.getSelection());
        };
        const onUp = (event: PointerEvent) => {
            if (pressed === undefined || event.button !== 0) return;
            const target = pressed;
            pressed = undefined;
            up(event, target, selectedBefore);
        };
        const onMove = (event: PointerEvent) => move(event);
        const onLeave = () => setHovered(null);
        list.addEventListener('pointermove', onMove);
        list.addEventListener('pointerleave', onLeave);
        list.addEventListener('pointerdown', onDown);
        // on the window: a selection dragged out of the list ends outside it
        window.addEventListener('pointerup', onUp);
        return () => {
            list.removeEventListener('pointermove', onMove);
            list.removeEventListener('pointerleave', onLeave);
            list.removeEventListener('pointerdown', onDown);
            window.removeEventListener('pointerup', onUp);
        };
    }, [listRef]);

    return hovered;
}
