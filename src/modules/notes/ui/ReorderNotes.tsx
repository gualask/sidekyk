import { IconChevronDown, IconChevronUp } from '@tabler/icons-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { RichText, useTranslation } from '@/shared/i18n';
import { altLabel } from '@/shared/platform/shortcut';
import { useWindowKeys } from '@/shared/ui/hooks/use-window-keys';
import { InlineField } from '@/shared/ui/InlineField';
import { isField } from '@/shared/ui/keys';
import type { NoteActions } from '../application/notes.queries';
import { noteTitle, openNotes } from '../model/notes';
import type { NoteList, ProjectNotes } from '../model/notes.types';

const ROW_HEIGHT = 34;
/** The keys that move the note picked, as this system names them. */
const UP = altLabel('↑');
const DOWN = altLabel('↓');
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
    const { t } = useTranslation();

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

    // the order and the note picked as the keys left them, ahead of the render that shows them:
    // keys pressed quickly go on from there
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
        actions.place(note, list.id, to);
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
                const from = order.current.indexOf(picked.current);
                const next = order.current[from + step];
                if (event.altKey) move(picked.current, from + step);
                else if (next) pick(next);
            }
        },
        { capture: true },
    );

    return (
        <div className="flex h-full min-w-0 flex-1 flex-col">
            <div className="flex items-center gap-2.5 px-3 pt-2.5 pb-1 text-[12.5px]">
                <span className="min-w-0 truncate">
                    <RichText text={t('reorder.title')} parts={{ list: <b>{list.name}</b> }} />
                </span>
                <span className="text-[11.5px] text-ui-text-muted">
                    <RichText
                        text={t('reorder.hint')}
                        parts={{
                            up: <kbd className="kbd">{UP}</kbd>,
                            down: <kbd className="kbd">{DOWN}</kbd>,
                        }}
                    />
                </span>
                <span className="flex-1" />
                <button type="button" className="btn-ghost-sm" onClick={onDone}>
                    {t('reorder.done')}
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
                                        title={`${t('reorder.up')} (${UP})`}
                                        aria-label={t('reorder.up')}
                                        onClick={() => move(note.id, row.index - 1)}
                                    >
                                        <IconChevronUp size={13} />
                                    </button>
                                    {typing === note.id ? (
                                        <PositionInput
                                            position={row.index + 1}
                                            count={open.length}
                                            onEnd={(to) => {
                                                setTyping(null);
                                                if (to !== null) move(note.id, to - 1);
                                            }}
                                        />
                                    ) : (
                                        <button
                                            type="button"
                                            className="h-6 min-w-8 rounded-md px-1 font-mono text-xs text-ui-text-secondary hover:bg-ui-surface-hover"
                                            title={t('reorder.typePosition', {
                                                count: open.length,
                                            })}
                                            aria-label={t('reorder.positionOf', {
                                                position: row.index + 1,
                                                count: open.length,
                                            })}
                                            onClick={() => {
                                                pick(note.id);
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
                                        title={`${t('reorder.down')} (${DOWN})`}
                                        aria-label={t('reorder.down')}
                                        onClick={() => move(note.id, row.index + 1)}
                                    >
                                        <IconChevronDown size={13} />
                                    </button>
                                </span>
                                <button
                                    type="button"
                                    className="h-full min-w-0 flex-1 truncate text-left text-[13px] text-ui-text-secondary focus-visible:outline-none"
                                    aria-pressed={on}
                                    onClick={() => pick(note.id)}
                                >
                                    {noteTitle(note.text)}
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
    const { t } = useTranslation();
    return (
        <InlineField
            initial={String(position)}
            onEnd={(typed) => {
                const value = typed === null ? Number.NaN : Number.parseInt(typed, 10);
                onEnd(Number.isFinite(value) && value >= 1 ? Math.min(value, count) : null);
            }}
            type="number"
            min={1}
            max={count}
            aria-label={t('reorder.position')}
            className="h-6 w-12 rounded-md border border-ui-accent bg-ui-surface px-1 text-center font-mono text-xs outline-none"
        />
    );
}
