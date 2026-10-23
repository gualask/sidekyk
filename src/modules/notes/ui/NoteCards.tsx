import { IconChevronDown } from '@tabler/icons-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from '@/shared/i18n';
import type { NoteActions } from '../application/notes.queries';
import { doneNotes, openNotes } from '../model/notes';
import type { Note, NoteList, ProjectNotes } from '../model/notes.types';
import { CardRows } from './CardRows';
import { Composer } from './Composer';
import { NoteCard } from './NoteCard';
import { useCardRows } from './use-card-rows';
import { useCardStates } from './use-card-states';

/** How long a note brought into view stays lit up, as its animation (`.note-flash`). */
const FLASH_MS = 1200;

type Item = { kind: 'note'; note: Note; index: number } | { kind: 'done'; count: number };

/**
 * The open list: a field on top to write or paste a note, then its cards in the user's order, the
 * done ones folded under "Done (n)". Only the cards on screen render.
 */
export function NoteCards({
    notes,
    list,
    actions,
    focusComposer,
    onComposerFocused,
    reveal,
    onRevealed,
    onReorder,
    onMove,
}: {
    notes: ProjectNotes;
    list: NoteList;
    actions: NoteActions;
    /** The field to write in takes the focus (as it shows): a list just made, `⌘N`. */
    focusComposer: boolean;
    onComposerFocused: () => void;
    /** A note of the list to bring into view, and light up for a moment (one found in the palette). */
    reveal: string | null;
    onRevealed: () => void;
    /** Starts reordering the open notes, on one of them. */
    onReorder: (id: string) => void;
    /** Opens the Move dialog for a note. */
    onMove: (note: Note) => void;
}) {
    const [showDone, setShowDone] = useState(false);
    const cardState = useCardStates();
    const { t } = useTranslation();

    const open = useMemo(() => openNotes(notes.notes, list.id), [notes.notes, list.id]);
    const done = useMemo(() => doneNotes(notes.notes, list.id), [notes.notes, list.id]);
    const items = useMemo<Item[]>(() => {
        const rows: Item[] = open.map((note, index) => ({ kind: 'note', note, index }));
        if (done.length > 0) {
            rows.push({ kind: 'done', count: done.length });
            if (showDone) {
                for (const note of done) rows.push({ kind: 'note', note, index: -1 });
            }
        }
        return rows;
    }, [open, done, showDone]);

    const rows = useCardRows(items.length, (index) => {
        const item = items[index];
        return item.kind === 'note' ? item.note.id : 'done';
    });
    const { virtualizer } = rows;

    // the note brought into view, lit up for a moment; a done one unfolds its group first
    const [flash, setFlash] = useState<string | null>(null);
    useEffect(() => {
        if (!reveal) return;
        const index = items.findIndex((item) => item.kind === 'note' && item.note.id === reveal);
        if (index < 0 && !showDone && done.some((note) => note.id === reveal)) {
            setShowDone(true);
            return;
        }
        if (index >= 0) {
            virtualizer.scrollToIndex(index, { align: 'center' });
            setFlash(reveal);
        }
        onRevealed();
    }, [reveal, items, showDone, done, virtualizer, onRevealed]);
    useEffect(() => {
        if (!flash) return;
        const timer = window.setTimeout(() => setFlash(null), FLASH_MS);
        return () => window.clearTimeout(timer);
    }, [flash]);

    const empty = open.length === 0 && done.length === 0;

    return (
        <div className="flex h-full min-w-0 flex-1 flex-col">
            <Composer
                focus={focusComposer}
                onFocused={onComposerFocused}
                placeholder={t('notes.composer', { list: list.name })}
                label={t('notes.newNoteIn', { list: list.name })}
                hint={empty ? t('notes.composerHint') : null}
                onAdd={async (text) => {
                    const added = await actions.add(list.id, text);
                    if (added) virtualizer.scrollToOffset(0);
                    return added !== undefined;
                }}
            />
            <CardRows rows={rows}>
                {(index) => {
                    const item = items[index];
                    return item.kind === 'done' ? (
                        <button
                            type="button"
                            className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs font-semibold text-ui-text-muted hover:bg-ui-surface-hover hover:text-ui-text-secondary"
                            aria-expanded={showDone}
                            onClick={() => setShowDone((shown) => !shown)}
                        >
                            <IconChevronDown
                                size={12}
                                className={`transition-transform motion-reduce:transition-none ${
                                    showDone ? '' : '-rotate-90'
                                }`}
                            />
                            {t('notes.doneCount', { count: item.count })}
                        </button>
                    ) : (
                        <NoteCard
                            note={item.note}
                            flash={flash === item.note.id}
                            actions={actions}
                            {...cardState(item.note)}
                            onDone={(done) => void actions.setDone(item.note, done)}
                            order={
                                item.index < 0 || open.length < 2
                                    ? null
                                    : {
                                          top: item.index === 0,
                                          moveToTop: () => {
                                              void actions.place(item.note, list.id, 0);
                                              virtualizer.scrollToOffset(0);
                                          },
                                          reorder: () => onReorder(item.note.id),
                                      }
                            }
                            onMove={() => onMove(item.note)}
                        />
                    );
                }}
            </CardRows>
        </div>
    );
}
