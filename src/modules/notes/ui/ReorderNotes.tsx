import { IconChevronDown, IconChevronUp } from '@tabler/icons-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useMemo, useRef, useState } from 'react';
import { MACOS } from '@/shared/platform/macos';
import { useWindowKeys } from '@/shared/ui/hooks/use-window-keys';
import { isField } from '@/shared/ui/keys';
import type { NoteActions } from '../application/notes.queries';
import { openNotes } from '../model/notes';
import type { NoteList, ProjectNotes } from '../model/notes.types';

const ROW_HEIGHT = 34;
/** The keys that move the note picked, as this system names them. */
const UP = MACOS ? '⌥↑' : 'Alt+↑';
const DOWN = MACOS ? '⌥↓' : 'Alt+↓';
const GAP = 4;

/** A note's first line, as a reorder row shows it. */
function firstLine(text: string): string {
    return text.trim().split('\n')[0] ?? '';
}

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

    const move = (index: number, to: number) => {
        const note = open[index];
        if (!note || to < 0 || to >= open.length || to === index) return;
        onSelect(note.id);
        void actions.place(note, list.id, to);
    };

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
                const step = event.key === 'ArrowUp' ? -1 : 1;
                if (event.altKey) move(at, at + step);
                else if (open[at + step]) onSelect(open[at + step].id);
            }
        },
        { capture: true },
    );

    return (
        <div className="flex h-full min-w-0 flex-1 flex-col">
            <div className="flex items-center gap-2.5 px-3 pt-2.5 pb-1 text-[12.5px]">
                <span className="min-w-0 truncate">
                    Reorder <b>{list.name}</b>
                </span>
                <span className="text-[11.5px] text-ui-text-muted">
                    <kbd className="kbd">{UP}</kbd> <kbd className="kbd">{DOWN}</kbd> or click a
                    number
                </span>
                <span className="flex-1" />
                <button type="button" className="btn-ghost-sm" onClick={onDone}>
                    Done
                </button>
            </div>
            <div ref={scroller} className="min-h-0 flex-1 overflow-auto px-3">
                <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
                    {virtualizer.getVirtualItems().map((row) => {
                        const note = open[row.index];
                        const on = note.id === selected;
                        return (
                            <div
                                key={row.key}
                                className={`absolute top-0 left-0 flex w-full items-center gap-2 rounded-lg border py-0.5 pr-2.5 pl-1 ${
                                    on
                                        ? 'border-ui-accent bg-ui-accent-soft'
                                        : 'border-ui-border bg-ui-surface-subtle'
                                }`}
                                style={{
                                    height: ROW_HEIGHT,
                                    transform: `translateY(${row.start}px)`,
                                }}
                            >
                                <span className="flex shrink-0 items-center">
                                    <button
                                        type="button"
                                        className="btn-icon h-6 w-6"
                                        disabled={row.index === 0}
                                        title={`Move up (${UP})`}
                                        aria-label="Move up"
                                        onClick={() => move(row.index, row.index - 1)}
                                    >
                                        <IconChevronUp size={13} />
                                    </button>
                                    {typing === note.id ? (
                                        <PositionInput
                                            position={row.index + 1}
                                            count={open.length}
                                            onEnd={(to) => {
                                                setTyping(null);
                                                if (to !== null) move(row.index, to - 1);
                                            }}
                                        />
                                    ) : (
                                        <button
                                            type="button"
                                            className="h-6 min-w-8 rounded-md px-1 font-mono text-xs text-ui-text-secondary hover:bg-ui-surface-hover"
                                            title={`Type a position (1–${open.length})`}
                                            aria-label={`Position ${row.index + 1} of ${open.length}`}
                                            onClick={() => {
                                                onSelect(note.id);
                                                setTyping(note.id);
                                            }}
                                        >
                                            {row.index + 1}
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        className="btn-icon h-6 w-6"
                                        disabled={row.index === open.length - 1}
                                        title={`Move down (${DOWN})`}
                                        aria-label="Move down"
                                        onClick={() => move(row.index, row.index + 1)}
                                    >
                                        <IconChevronDown size={13} />
                                    </button>
                                </span>
                                <button
                                    type="button"
                                    className="h-full min-w-0 flex-1 truncate text-left text-[13px] text-ui-text-secondary focus-visible:outline-none"
                                    aria-pressed={on}
                                    onClick={() => onSelect(note.id)}
                                >
                                    {firstLine(note.text)}
                                </button>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}

/** A position typed in: `↵` or leaving the field moves the note there, `Esc` leaves it. */
function PositionInput({
    position,
    count,
    onEnd,
}: {
    position: number;
    count: number;
    onEnd: (position: number | null) => void;
}) {
    const ended = useRef(false);
    const field = useRef<HTMLInputElement>(null);
    // typing a position is why the field shows
    useEffect(() => {
        field.current?.focus();
        field.current?.select();
    }, []);
    const end = (value: number | null) => {
        if (ended.current) return;
        ended.current = true;
        onEnd(value);
    };
    const typed = (field: HTMLInputElement) => {
        const value = Number.parseInt(field.value, 10);
        return Number.isFinite(value) && value >= 1 ? Math.min(value, count) : null;
    };
    return (
        <input
            type="number"
            min={1}
            max={count}
            defaultValue={position}
            ref={field}
            aria-label="Position"
            className="h-6 w-12 rounded-md border border-ui-accent bg-ui-surface px-1 text-center font-mono text-xs outline-none"
            onKeyDown={(event) => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    end(typed(event.currentTarget));
                } else if (event.key === 'Escape') {
                    event.preventDefault();
                    end(null);
                }
            }}
            onBlur={(event) => end(typed(event.currentTarget))}
        />
    );
}
