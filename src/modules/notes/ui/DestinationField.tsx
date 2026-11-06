import { Autocomplete } from '@base-ui/react/autocomplete';
import { IconFolderCode, IconInbox, IconList, IconPlus, IconX } from '@tabler/icons-react';
import type { RefObject } from 'react';
import { type Translator, useTranslation } from '@/shared/i18n';
import { keysLabel } from '@/shared/platform/keys';
import { FolderPath } from '@/shared/projects/FolderPath';
import { RemoteTag } from '@/shared/projects/RemoteTag';
import { PickerField } from '@/shared/ui/PickerDialog';
import {
    choiceName,
    completed,
    type MoveBook,
    type MoveRow,
    type MoveState,
    type MoveSubject,
    moveOf,
    typed,
    withoutChip,
} from '../model/destination';
import { openListOf } from '../model/notes';
import { INBOX_BOOK, type ProjectNotes } from '../model/notes.types';
import type { Destination } from './use-destination';

/**
 * The field that chooses where something goes, as Move and the quick note have it: the chips
 * (the book, then its list) before what is typed, suggestions ranked as the palette ranks names.
 * `Tab` makes the suggestion chosen a chip; Backspace on the empty field takes the last chip
 * away, as × does; typing over a chip that ends the way (a list, the Inbox) chooses again in its
 * place; `↵` calls `onEnter` with the suggestion chosen, if any. The suggestions show under the
 * field, always (a dialog), or in a popup above it while `popup` says (the quick note).
 */
export function DestinationField({
    destination,
    input,
    label,
    popup = null,
    place,
    onEnter,
    onEscape,
    onFocus,
    onBlur,
}: {
    destination: Destination;
    input: RefObject<HTMLInputElement | null>;
    label: string;
    /** Null: the suggestions under the field, always; else in a popup above it, while true. */
    popup?: boolean | null;
    /** The field's margins, when not under a dialog's title. */
    place?: string;
    onEnter: (row: MoveRow | null) => void;
    /** `Esc` in the field, if it takes it (else the dialog's). */
    onEscape?: () => void;
    onFocus?: () => void;
    onBlur?: () => void;
}) {
    const i18n = useTranslation();
    const { t } = i18n;
    const { subject, state, setState, rows, shared, chipNotes } = destination;
    /** A chip taken away by a click: the field keeps the focus. */
    const change = (next: MoveState) => {
        setState(next);
        input.current?.focus();
    };
    const list = (
        <Autocomplete.List
            className={
                popup === null
                    ? 'max-h-[50vh] min-h-0 overflow-auto overscroll-contain px-1.5 pb-1.5 empty:hidden'
                    : 'max-h-[var(--available-height)] overflow-auto overscroll-contain'
            }
        >
            {rows.map((row, index) => (
                <Autocomplete.Item
                    key={rowKey(row)}
                    value={row}
                    index={index}
                    onClick={(event) => {
                        // the row acts as ↵ does, the field kept as it is
                        event.preventBaseUIHandler();
                        onEnter(row);
                    }}
                    className="pick-row group min-h-[34px] py-1"
                >
                    <Row row={row} shared={row.kind === 'book' && shared.has(row.book)} />
                </Autocomplete.Item>
            ))}
        </Autocomplete.List>
    );

    return (
        <Autocomplete.Root
            // a popup shows only with something to choose
            open={popup === null || (popup && rows.length > 0)}
            inline={popup === null}
            items={rows}
            filter={null}
            value={state.query}
            onValueChange={(query) => setState((current) => typed(current, query))}
            itemToStringValue={(row: MoveRow) => choiceName(row)}
            autoHighlight
            onItemHighlighted={(row) => destination.setHighlighted(row ?? null)}
        >
            <PickerField
                place={place}
                pending={destination.pending}
                before={
                    state.chip ? (
                        <>
                            <Chip
                                name={state.chip.name}
                                onRemove={() => change({ chip: null, list: null, query: '' })}
                            />
                            {state.list ? (
                                <Chip
                                    name={choiceName(state.list)}
                                    onRemove={() => change({ ...state, list: null })}
                                />
                            ) : null}
                        </>
                    ) : null
                }
                ref={input}
                aria-label={label}
                // what to type, while its suggestions can show
                placeholder={
                    popup === false ? undefined : placeholder(subject, state, chipNotes, i18n)
                }
                onFocus={onFocus}
                onBlur={onBlur}
                onKeyDown={(event) => {
                    if (event.metaKey || event.ctrlKey || event.altKey) return;
                    if (event.key === 'Tab' && !event.shiftKey) {
                        event.preventDefault();
                        setState(completed(subject, state, destination.highlighted));
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
                        onEnter(destination.highlighted);
                    } else if (event.key === 'Escape' && onEscape) {
                        event.preventDefault();
                        event.preventBaseUIHandler();
                        onEscape();
                    }
                }}
            />
            {popup === null ? (
                list
            ) : (
                <Autocomplete.Portal>
                    <Autocomplete.Positioner
                        side="top"
                        align="start"
                        sideOffset={6}
                        collisionPadding={8}
                        className="z-50"
                    >
                        <Autocomplete.Popup
                            aria-label={t('notes.moveWhere')}
                            className="menu-popup w-[max(var(--anchor-width),280px)] text-[13px] empty:hidden"
                        >
                            {list}
                        </Autocomplete.Popup>
                    </Autocomplete.Positioner>
                </Autocomplete.Portal>
            )}
        </Autocomplete.Root>
    );
}

/** A choice made, as a chip; × takes it away. Out of the Tab order: Tab completes. */
function Chip({ name, onRemove }: { name: string; onRemove: () => void }) {
    const { t } = useTranslation();
    return (
        <span className="chip shrink-0 gap-0.5 pr-0.5">
            <span className="max-w-[180px] truncate">{name}</span>
            <button
                type="button"
                tabIndex={-1}
                className="btn-icon h-5 w-5"
                aria-label={t('notes.moveUnchip', { name })}
                // the field keeps the focus
                onMouseDown={(event) => event.preventDefault()}
                onClick={onRemove}
            >
                <IconX size={12} />
            </button>
        </span>
    );
}

/** A suggestion: a book (its folder under it when another has its name), a list, or a new one. */
function Row({ row, shared }: { row: MoveRow; shared: boolean }) {
    const { t } = useTranslation();
    const iconClass = 'shrink-0 text-ui-text-muted group-data-highlighted:text-ui-accent-on-soft';
    if (row.kind === 'newList') {
        return (
            <>
                <IconPlus size={16} stroke={1.75} className={iconClass} />
                <span className="min-w-0 truncate">
                    {t('notes.moveNewList', { name: row.name })}
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
    return <BookRow book={row.book} shared={shared} iconClass={iconClass} />;
}

function BookRow({
    book,
    shared,
    iconClass,
}: {
    book: MoveBook;
    shared: boolean;
    iconClass: string;
}) {
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

function rowKey(row: MoveRow): string {
    if (row.kind === 'book') return `book:${row.book.book}`;
    if (row.kind === 'list') return `list:${row.list.id}`;
    return row.kind;
}

/**
 * What the field asks for: a book; a list of the chip's project, or `↵` for the one it opens on;
 * `↵` for the Inbox, where a note is moved there; nothing once a list is chosen.
 */
function placeholder(
    subject: MoveSubject,
    state: MoveState,
    chipNotes: ProjectNotes | undefined,
    { t }: Translator,
): string | undefined {
    const { chip } = state;
    if (state.list) return undefined;
    const books = t(
        subject.kind === 'list' || (subject.kind === 'note' && subject.book === INBOX_BOOK)
            ? 'notes.moveToProject'
            : 'notes.moveToBook',
    );
    if (!chip) return books;
    if (chip.book === INBOX_BOOK) {
        // a note being written is there already: typing chooses another
        return subject.kind === 'new'
            ? books
            : t('notes.moveToInbox', { enter: keysLabel('Enter') });
    }
    // ↵ alone goes into the list the project opens on, unless the note is already there
    const alone = moveOf(subject, { chip, list: null, query: '' }, chipNotes);
    return chipNotes && alone
        ? t('notes.moveToListOr', { enter: keysLabel('Enter'), list: openListOf(chipNotes).name })
        : t('notes.moveToList');
}
