import { IconChevronDown } from '@tabler/icons-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useMemo, useRef, useState } from 'react';
import { shortcutLabel } from '@/shared/platform/shortcut';
import { useCopyToClipboard } from '@/shared/ui/hooks/use-copy-to-clipboard';
import type { NoteActions } from '../application/notes.queries';
import { onNoteFieldKey, useNotesSettings } from '../application/notes-settings';
import { doneNotes, openNotes } from '../model/notes';
import type { Note, NoteList, ProjectNotes } from '../model/notes.types';
import { NoteCard } from './NoteCard';
import { autosize, linesClass } from './notes-layout';

/** The room between cards, and around them, in pixels. */
const GAP = 6;
/** A card's height before it is measured: one line of text and its meta. */
const CARD_ESTIMATE = 64;
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
}) {
    const [showDone, setShowDone] = useState(false);
    const [editing, setEditing] = useState<string | null>(null);
    const { copied, copy } = useCopyToClipboard();

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

    const scroller = useRef<HTMLDivElement>(null);
    const virtualizer = useVirtualizer({
        count: items.length,
        getScrollElement: () => scroller.current,
        estimateSize: () => CARD_ESTIMATE,
        getItemKey: (index) => {
            const item = items[index];
            return item.kind === 'note' ? item.note.id : 'done';
        },
        gap: GAP,
        paddingStart: GAP,
        paddingEnd: 12,
        overscan: 6,
    });

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
                list={list}
                hint={empty}
                onAdd={async (text) => {
                    const added = await actions.add(list.id, text);
                    if (added) virtualizer.scrollToOffset(0);
                    return added !== undefined;
                }}
            />
            <div ref={scroller} className="min-h-0 flex-1 overflow-auto px-3">
                <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
                    {virtualizer.getVirtualItems().map((row) => {
                        const item = items[row.index];
                        return (
                            <div
                                key={row.key}
                                ref={virtualizer.measureElement}
                                data-index={row.index}
                                className="absolute top-0 left-0 w-full"
                                style={{ transform: `translateY(${row.start}px)` }}
                            >
                                {item.kind === 'done' ? (
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
                                        Done ({item.count})
                                    </button>
                                ) : (
                                    <NoteCard
                                        note={item.note}
                                        flash={flash === item.note.id}
                                        lists={notes.lists}
                                        editing={editing === item.note.id}
                                        onEdit={(on) => setEditing(on ? item.note.id : null)}
                                        actions={actions}
                                        copied={copied?.id === item.note.id ? copied : null}
                                        onCopy={() => void copy(item.note.id, item.note.text)}
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
                                    />
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}

/**
 * The field on top: `↵` adds the note, `⇧↵` breaks the line, a paste into the empty field adds it
 * at once.
 */
function Composer({
    focus,
    onFocused,
    list,
    hint,
    onAdd,
}: {
    focus: boolean;
    onFocused: () => void;
    list: NoteList;
    hint: boolean;
    /** Whether the note was added. */
    onAdd: (text: string) => Promise<boolean>;
}) {
    const [text, setText] = useState('');
    const field = useRef<HTMLTextAreaElement>(null);
    const settings = useNotesSettings();
    useEffect(() => {
        if (!focus) return;
        field.current?.focus();
        onFocused();
    }, [focus, onFocused]);
    // one note at a time: a second ↵ while the first is being added adds nothing
    const adding = useRef(false);
    // the field keeps the text until the note is added: a failure loses nothing; what was typed
    // meanwhile stays
    const add = async (value: string) => {
        const note = value.trimEnd();
        if (note.trim() === '' || adding.current) return;
        adding.current = true;
        const added = await onAdd(note);
        adding.current = false;
        const typed = field.current;
        if (!added || !typed || typed.value !== value) return;
        setText('');
        typed.value = '';
        autosize(typed);
    };

    return (
        <div className="px-3 pt-2.5 pb-1">
            <textarea
                ref={field}
                rows={1}
                value={text}
                spellCheck={false}
                placeholder={`Write or paste a note in ${list.name}…  ${shortcutLabel('N')}`}
                aria-label={`New note in ${list.name}`}
                wrap={settings.lines === 'wrap' ? 'soft' : 'off'}
                className={`block max-h-[132px] w-full resize-none rounded-lg border border-ui-border bg-ui-surface-subtle px-2.5 py-[7px] text-[13px]/[1.5] text-ui-text outline-none placeholder:text-ui-text-muted focus:border-ui-accent ${linesClass(settings.lines)}`}
                onChange={(event) => {
                    setText(event.target.value);
                    autosize(event.target);
                }}
                onKeyDown={(event) => {
                    if (onNoteFieldKey(event, settings)) return;
                    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) {
                        return;
                    }
                    event.preventDefault();
                    void add(text);
                }}
                onPaste={(event) => {
                    if (text !== '') return;
                    const pasted = event.clipboardData.getData('text/plain');
                    if (pasted.trim() === '') return;
                    event.preventDefault();
                    void add(pasted);
                }}
            />
            {hint ? (
                <p className="px-0.5 pt-1 text-[11.5px] text-ui-text-muted">
                    Things to try, or what the agent said, to paste back later.
                </p>
            ) : null}
        </div>
    );
}
