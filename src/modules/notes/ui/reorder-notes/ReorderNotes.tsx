import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { RichText, useTranslation } from '@/shared/i18n';
import { useWindowKeys } from '@/shared/ui/hooks/use-window-keys';
import { KeyHint } from '@/shared/ui/KeyCaps';
import { isField } from '@/shared/ui/keys';
import type { NoteActions } from '../../application/note-actions/note-actions';
import { openNotes } from '../../model/notes';
import type { Note, NoteList, ProjectNotes } from '../../model/notes.types';
import { DOWN, ReorderRow, ROW_HEIGHT, UP } from './ReorderRow';

const GAP = 4;

/**
 * Reorder mode: one line per open note, so the whole list fits. `↑`/`↓` pick a note, `⌥↑`/`⌥↓`
 * move it, its number takes a position typed in for long jumps; `Esc`, `↵` or Done leave.
 */
export function ReorderNotes({
    notes,
    list,
    actions,
    selected,
    onSelect,
    onDone,
    hasKeys,
}: {
    notes: ProjectNotes;
    list: NoteList;
    actions: NoteActions;
    selected: string;
    onSelect: (id: string) => void;
    onDone: () => void;
    /** The panel takes the keys. */
    hasKeys: boolean;
}) {
    const open = useMemo(() => openNotes(notes.notes, list.id), [notes.notes, list.id]);
    const at = open.findIndex((note) => note.id === selected);
    // the note whose position is being typed
    const [typing, setTyping] = useState<string | null>(null);

    const scroller = useRef<HTMLDivElement>(null);
    const virtualizer = useVirtualizer({
        count: open.length,
        getScrollElement: () => scroller.current,
        estimateSize: () => ROW_HEIGHT,
        getItemKey: (index) => open[index].id,
        gap: GAP,
        paddingStart: GAP,
        paddingEnd: 12,
        overscan: 10,
    });
    useEffect(() => {
        if (at >= 0) virtualizer.scrollToIndex(at, { align: 'auto' });
    }, [at, virtualizer]);

    const { pick, move, step } = useReorder(open, selected, onSelect, (note, to) =>
        actions.place(note, list.id, to),
    );

    // before the workspace's keys: `↵` and `Esc` leave the mode instead of zooming
    useWindowKeys(
        (event) => {
            if (!hasKeys || event.defaultPrevented || isField(event.target)) return;
            if (event.metaKey || event.ctrlKey) return;
            if (event.key === 'Escape' || event.key === 'Enter') {
                event.preventDefault();
                onDone();
            } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                event.preventDefault();
                step(event.key === 'ArrowUp' ? -1 : 1, event.altKey);
            }
        },
        { capture: true },
    );

    return (
        <div className="flex h-full min-w-0 flex-1 flex-col">
            <ReorderHeader list={list} onDone={onDone} />
            <div ref={scroller} className="min-h-0 flex-1 overflow-auto px-3">
                <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
                    {virtualizer.getVirtualItems().map((row) => {
                        const note = open[row.index];
                        return (
                            <ReorderRow
                                key={row.key}
                                note={note}
                                index={row.index}
                                count={open.length}
                                start={row.start}
                                picked={note.id === selected}
                                typing={typing === note.id}
                                onTyping={(on) => {
                                    if (on) pick(note.id);
                                    setTyping(on ? note.id : null);
                                }}
                                onPick={() => pick(note.id)}
                                onMove={(to) => move(note.id, to)}
                            />
                        );
                    })}
                </div>
            </div>
        </div>
    );
}

/**
 * The order and the note picked as the keys left them, ahead of the render that shows them: keys
 * pressed quickly go on from there. `move` puts a note at a position (`place` saves it), `step`
 * picks the note above or below, or moves the one picked there.
 */
function useReorder(
    open: readonly Note[],
    selected: string,
    onSelect: (id: string) => void,
    place: (note: Note, to: number) => void,
) {
    const order = useRef<string[]>([]);
    const picked = useRef(selected);
    useLayoutEffect(() => {
        order.current = open.map((note) => note.id);
        picked.current = selected;
    }, [open, selected]);
    const pick = (id: string) => {
        picked.current = id;
        onSelect(id);
    };
    const move = (id: string, to: number) => {
        const ids = order.current;
        const from = ids.indexOf(id);
        const note = open.find((open) => open.id === id);
        if (!note || from < 0 || to < 0 || to >= ids.length || to === from) return;
        ids.splice(from, 1);
        ids.splice(to, 0, id);
        pick(id);
        place(note, to);
    };
    const step = (by: number, moving: boolean) => {
        const from = order.current.indexOf(picked.current);
        const next = order.current[from + by];
        if (moving) move(picked.current, from + by);
        else if (next) pick(next);
    };
    return { pick, move, step };
}

/** The mode's title, its keys, and Done. */
function ReorderHeader({ list, onDone }: { list: NoteList; onDone: () => void }) {
    const { t } = useTranslation();
    return (
        <div className="flex items-center gap-2.5 px-3 pt-2.5 pb-1 text-[12.5px]">
            <span className="min-w-0 truncate">
                <RichText text={t('reorder.title')} parts={{ list: <b>{list.name}</b> }} />
            </span>
            <span className="text-[11.5px] text-ui-text-muted">
                <KeyHint text={t('reorder.hint')} keys={{ up: UP, down: DOWN }} />
            </span>
            <span className="flex-1" />
            <button type="button" className="btn-ghost-sm" onClick={onDone}>
                {t('reorder.done')}
            </button>
        </div>
    );
}
