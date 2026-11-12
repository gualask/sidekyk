import { Autocomplete } from '@base-ui/react/autocomplete';
import { IconX } from '@tabler/icons-react';
import type { ComponentProps, RefObject } from 'react';
import { type Translator, useTranslation } from '@/shared/i18n';
import { keysLabel } from '@/shared/platform/keys';
import { PickerField } from '@/shared/ui/PickerDialog';
import {
    choiceName,
    completed,
    type MoveRow,
    type MoveState,
    type MoveSubject,
    moveOf,
    typed,
    withoutChip,
} from '../../model/destination';
import { openListOf } from '../../model/notes';
import { INBOX_BOOK, type ProjectNotes } from '../../model/notes.types';
import { Suggestions, SuggestionsPopup } from './Suggestions';
import type { Destination } from './use-destination';

/** A key pressed in the field, as Base UI gives it. */
type FieldKeyEvent = Parameters<NonNullable<ComponentProps<typeof PickerField>['onKeyDown']>>[0];

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
    const { subject, state, setState, rows, chipNotes } = destination;
    const list = (
        <Suggestions destination={destination} inline={popup === null} onEnter={onEnter} />
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
                before={<Chips state={state} onChange={setState} input={input} />}
                ref={input}
                aria-label={label}
                // what to type, while its suggestions can show
                placeholder={
                    popup === false ? undefined : placeholder(subject, state, chipNotes, i18n)
                }
                onFocus={onFocus}
                onBlur={onBlur}
                onKeyDown={(event) => fieldKey(event, destination, onEnter, onEscape)}
            />
            {popup === null ? list : <SuggestionsPopup>{list}</SuggestionsPopup>}
        </Autocomplete.Root>
    );
}

/** A key in the field: `Tab`, Backspace, `↵` and `Esc` (if the field takes it), unmodified. */
function fieldKey(
    event: FieldKeyEvent,
    destination: Destination,
    onEnter: (row: MoveRow | null) => void,
    onEscape: (() => void) | undefined,
) {
    const { subject, state, setState } = destination;
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
}

/**
 * The chips before what is typed: the book, then its list, if chosen. A chip taken away by a
 * click: the field keeps the focus.
 */
function Chips({
    state,
    onChange,
    input,
}: {
    state: MoveState;
    onChange: (state: MoveState) => void;
    input: RefObject<HTMLInputElement | null>;
}) {
    if (!state.chip) return null;
    const change = (next: MoveState) => {
        onChange(next);
        input.current?.focus();
    };
    return (
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
