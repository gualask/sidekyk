import { Autocomplete } from '@base-ui/react/autocomplete';
import { IconFolderCode, IconInbox, IconList, IconPlus, IconX } from '@tabler/icons-react';
import { type RefObject, useMemo, useRef, useState } from 'react';
import { type Translator, useTranslation } from '@/shared/i18n';
import { keysLabel } from '@/shared/platform/keys';
import { FolderPath } from '@/shared/projects/FolderPath';
import { RemoteTag } from '@/shared/projects/RemoteTag';
import { useRanking } from '@/shared/ui/hooks/use-ranking';
import { KeyHint } from '@/shared/ui/KeyCaps';
import { PickerDialog, PickerField, PickerKeys } from '@/shared/ui/PickerDialog';
import { useMoveTargets } from '../application/move-targets';
import { useNotes } from '../application/notes.queries';
import {
    completed,
    type Entered,
    entered,
    initialMove,
    type Move,
    type MoveRow,
    type MoveState,
    type MoveSubject,
    moveBooks,
    moveRows,
    moveStep,
    namesShared,
    stepNames,
    withoutChip,
} from '../model/move-dialog';
import { noteTitle, openListOf } from '../model/notes';
import { INBOX_BOOK, type ProjectNotes } from '../model/notes.types';

/**
 * Where a note or a list goes: one field, suggestions ranked as the palette ranks names. A note
 * picks a book, then (`Tab` makes it a chip) one of its lists; a list picks a project. Text that
 * names nothing offers to make it: a project without folder, or a list. `↑`/`↓` choose, `↵` moves,
 * `Esc` closes; Backspace on the empty field takes the chip away. Loaded with its first opening.
 */
export function MoveDialog({
    subject,
    onMove,
    onClose,
}: {
    subject: MoveSubject;
    onMove: (move: Move) => void;
    onClose: () => void;
}) {
    const { t } = useTranslation();
    const input = useRef<HTMLInputElement>(null);
    return (
        <PickerDialog
            onOpenChange={(open) => {
                if (!open) onClose();
            }}
            title={t(subject.kind === 'note' ? 'notes.moveNote' : 'notes.moveList')}
            description={subject.kind === 'note' ? noteTitle(subject.note.text) : subject.list.name}
            initialFocus={input}
            width="w-[min(520px,calc(100vw-32px))]"
        >
            <MoveField
                input={input}
                subject={subject}
                onMove={(move) => {
                    onClose();
                    onMove(move);
                }}
            />
        </PickerDialog>
    );
}

/** The field, its chip and its suggestions. */
function MoveField({
    input,
    subject,
    onMove,
}: {
    input: RefObject<HTMLInputElement | null>;
    subject: MoveSubject;
    onMove: (move: Move) => void;
}) {
    const { projects, rank } = useMoveTargets();
    const i18n = useTranslation();
    const { t } = i18n;
    const books = useMemo(
        () => moveBooks(subject, projects, t('inbox.title')),
        [subject, projects, t],
    );
    const shared = useMemo(() => namesShared(books), [books]);
    const [state, setState] = useState<MoveState>(() => initialMove(subject, books));
    const [highlighted, setHighlighted] = useState<MoveRow | null>(null);
    // the lists of the chip's project; the Inbox's are never picked
    const chipBook = state.chip?.book ?? INBOX_BOOK;
    const { data: chipNotes } = useNotes(chipBook, chipBook !== INBOX_BOOK);
    const step = useMemo(
        () => moveStep(subject, state.chip, books, chipNotes),
        [subject, state.chip, books, chipNotes],
    );
    const names = useMemo(() => stepNames(step), [step]);
    const order = useRanking(rank, state.query, names);
    const rows = useMemo(() => moveRows(step, state.query, order), [step, state.query, order]);

    /** A chip put or taken away by a click: the field keeps the focus. */
    const change = (next: MoveState) => {
        setState(next);
        input.current?.focus();
    };
    const act = (result: Entered) => {
        if (result?.kind === 'move') onMove(result.move);
        else if (result?.kind === 'chip') change(result.state);
    };

    return (
        <Autocomplete.Root
            open
            inline
            items={rows}
            filter={null}
            value={state.query}
            onValueChange={(query) => setState((current) => ({ ...current, query }))}
            itemToStringValue={(row: MoveRow) => rowName(row)}
            autoHighlight
            onItemHighlighted={(row) => setHighlighted(row ?? null)}
        >
            <PickerField
                before={
                    state.chip ? (
                        <span className="chip shrink-0 gap-0.5 pr-0.5">
                            <span className="max-w-[180px] truncate">{state.chip.name}</span>
                            {/* out of the Tab order: Tab completes, Backspace takes the chip away */}
                            <button
                                type="button"
                                tabIndex={-1}
                                className="btn-icon h-5 w-5"
                                aria-label={t('notes.moveUnchip', { name: state.chip.name })}
                                onClick={() => change({ chip: null, query: '' })}
                            >
                                <IconX size={12} />
                            </button>
                        </span>
                    ) : null
                }
                ref={input}
                aria-label={t('notes.moveWhere')}
                placeholder={placeholder(subject, state, chipNotes, i18n)}
                onKeyDown={(event) => {
                    if (event.metaKey || event.ctrlKey || event.altKey) return;
                    if (event.key === 'Tab' && !event.shiftKey) {
                        event.preventDefault();
                        setState(completed(subject, state, highlighted));
                    } else if (event.key === 'Backspace') {
                        const next = withoutChip(state);
                        if (next) {
                            event.preventDefault();
                            setState(next);
                        }
                    } else if (event.key === 'Enter') {
                        // one way for every ↵: with a row chosen or not
                        event.preventDefault();
                        event.preventBaseUIHandler();
                        act(entered(subject, state, highlighted, chipNotes));
                    }
                }}
            />
            <Autocomplete.List className="max-h-[50vh] min-h-0 overflow-auto overscroll-contain px-1.5 pb-1.5 empty:hidden">
                {rows.map((row, index) => (
                    <Autocomplete.Item
                        key={rowKey(row)}
                        value={row}
                        index={index}
                        onClick={(event) => {
                            // the row acts as ↵ does, the field kept as it is
                            event.preventBaseUIHandler();
                            act(entered(subject, state, row, chipNotes));
                        }}
                        className="pick-row group min-h-[34px] py-1"
                    >
                        <Row row={row} shared={row.kind === 'book' && shared.has(row.book)} />
                    </Autocomplete.Item>
                ))}
            </Autocomplete.List>
            <PickerKeys enter={t('notes.moveEnter')}>
                {subject.kind === 'note' && !state.chip ? (
                    <span>
                        <KeyHint text={t('notes.moveComplete')} keys={{ tab: 'Tab' }} />
                    </span>
                ) : null}
            </PickerKeys>
        </Autocomplete.Root>
    );
}

/** A suggestion: a book (its folder under it when another has its name), a list, or a new one. */
function Row({ row, shared }: { row: MoveRow; shared: boolean }) {
    const { t } = useTranslation();
    const iconClass = 'shrink-0 text-ui-text-muted group-data-highlighted:text-ui-accent-on-soft';
    if (row.kind === 'newProject' || row.kind === 'newList') {
        return (
            <>
                <IconPlus size={16} stroke={1.75} className={iconClass} />
                <span className="min-w-0 truncate">
                    {t(row.kind === 'newProject' ? 'notes.moveNewProject' : 'notes.moveNewList', {
                        name: row.name,
                    })}
                </span>
            </>
        );
    }
    if (row.kind === 'list') {
        return (
            <>
                <IconList size={16} stroke={1.75} className={iconClass} />
                <span className="min-w-0 truncate">{row.list.name}</span>
            </>
        );
    }
    const { book } = row;
    const Icon = book.book === INBOX_BOOK ? IconInbox : IconFolderCode;
    return (
        <>
            <Icon size={16} stroke={1.75} className={iconClass} />
            <span className="flex min-w-0 flex-col">
                <span className="truncate">{book.name}</span>
                {book.folder && shared ? <FolderPath path={book.folder.root} /> : null}
            </span>
            <RemoteTag folder={book.folder} className="ml-auto" />
        </>
    );
}

function rowName(row: MoveRow): string {
    if (row.kind === 'book') return row.book.name;
    if (row.kind === 'list') return row.list.name;
    return row.name;
}

function rowKey(row: MoveRow): string {
    if (row.kind === 'book') return `book:${row.book.book}`;
    if (row.kind === 'list') return `list:${row.list.id}`;
    return row.kind;
}

/** What the field asks for: a book, a list of the chip's project, or `↵` for the Inbox. */
function placeholder(
    subject: MoveSubject,
    state: MoveState,
    chipNotes: ProjectNotes | undefined,
    { t }: Translator,
): string {
    const { chip } = state;
    if (!chip) {
        return t(
            subject.kind === 'note' && subject.book !== INBOX_BOOK
                ? 'notes.moveToBook'
                : 'notes.moveToProject',
        );
    }
    if (chip.book === INBOX_BOOK) return t('notes.moveToInbox', { enter: keysLabel('Enter') });
    // ↵ alone goes into the list the project opens on, unless the note is already there
    const alone = entered(subject, { chip, query: '' }, null, chipNotes);
    return chipNotes && alone
        ? t('notes.moveToListOr', { enter: keysLabel('Enter'), list: openListOf(chipNotes).name })
        : t('notes.moveToList');
}
