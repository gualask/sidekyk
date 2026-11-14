import { type KeyboardEvent, useMemo, useState } from 'react';
import { shortcutKey } from '@/shared/platform/shortcut';
import {
    labelInside,
    type MarkHistory,
    type MarkShape,
    markShape,
    markSize,
    redone,
    undone,
    withMarkText,
    withoutMark,
    withStep,
} from '../../model/marks';
import type { Mark } from '../../model/notes.types';
import { markInk, textMeasure } from './drawing/draw-marks';
import type { Size } from './use-room';

/** The text a mark is being given, before it is kept. */
interface Editing {
    index: number;
    text: string;
}

/** How the marks' history changes: as a state setter's update. */
export type HistoryChange = (change: (history: MarkHistory) => MarkHistory) => void;

/**
 * The marks of an image of `image`'s size, their history held by the caller (`history`,
 * `onHistory`): the draft a drag shows over them, the mark selected and the text being written,
 * their labels' size and ink.
 */
export function useMarkSession(history: MarkHistory, onHistory: HistoryChange, image: Size) {
    const ink = useMemo(markInk, []);
    const size = markSize(image.width, image.height);
    const [draft, setDraft] = useState<Mark[] | null>(null);
    const [selected, setSelected] = useState<number | null>(null);
    const [editing, setEditing] = useState<Editing | null>(null);
    const present = history.present;

    /** The shapes of `list`, to find what a pointer is on: of the marks it acts on, not of the
     * last drawing, which may be behind them. */
    const shapesOf = (list: readonly Mark[]): MarkShape[] => {
        const measure = textMeasure(size, ink);
        return list.map((mark) => markShape(mark, size, measure));
    };

    /** A step kept, every label whole inside the image. */
    const commit = (next: Mark[]) => {
        const shapes = shapesOf(next);
        const inside = next.map((mark, index) =>
            labelInside(mark, shapes[index], image.width, image.height),
        );
        onHistory((h) => withStep(h, inside));
    };

    /** The marks with the text being written in. */
    const pending = (): Mark[] =>
        editing ? withMarkText(present, editing.index, editing.text) : present;

    /** The marks with the text being written kept, the field closed. */
    const settled = (): Mark[] => {
        if (!editing) return present;
        const next = pending();
        commit(next);
        setEditing(null);
        if (next.length < present.length) setSelected(null);
        return next;
    };

    return {
        image,
        ink,
        size,
        present,
        /** What the canvas shows: the draft while a drag lasts. */
        marks: draft ?? present,
        selected,
        editing,
        shapesOf,
        commit,
        setDraft,
        setSelected,
        setEditing,
        pending,
        settled,
        /** Opens the field writing the text of the mark at `index`, selected. */
        edit: (index: number) => {
            setSelected(index);
            setEditing({ index, text: present[index].text });
        },
        step: (to: typeof undone) => {
            onHistory(to);
            setSelected(null);
        },
        /** Takes the mark at `index` out. */
        remove: (index: number) => {
            commit(withoutMark(present, index));
            setSelected(null);
        },
    };
}

export type MarkSession = ReturnType<typeof useMarkSession>;

type MarkCommand = 'remove' | 'edit' | 'undo' | 'redo';

/**
 * What a key does to the marks of `session`, done (true) or not its own (false): `⌫` takes the
 * selected out, `↵` writes its text, `⌘Z`/`⇧⌘Z` undo and redo.
 */
export function onMarkKey(event: KeyboardEvent, session: MarkSession): boolean {
    const command = markCommand(event, session.selected, session.present);
    if (!command) return false;
    event.preventDefault();
    const { selected } = session;
    if (command === 'undo') session.step(undone);
    else if (command === 'redo') session.step(redone);
    else if (selected === null) return true;
    else if (command === 'remove') session.remove(selected);
    else session.edit(selected);
    return true;
}

function markCommand(
    event: KeyboardEvent,
    selected: number | null,
    marks: readonly Mark[],
): MarkCommand | null {
    const shortcut = shortcutKey(event);
    if ((event.key === 'Backspace' || event.key === 'Delete') && selected !== null) return 'remove';
    if (event.key === 'Enter' && selected !== null && marks[selected]) return 'edit';
    if (shortcut === 'z') return event.shiftKey ? 'redo' : 'undo';
    if (shortcut === 'y') return 'redo';
    return null;
}
