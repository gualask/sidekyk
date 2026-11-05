import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
    type KeyboardEvent,
    type MouseEvent,
    type RefObject,
    useId,
    useLayoutEffect,
    useRef,
    useState,
} from 'react';
import { hasShortcutModifier } from '@/shared/platform/shortcut';
import { useNoteEntities, useNoteReferences, useOpenEntity } from '../application/note-references';
import { nameable, typingAt, withSuggestion } from '../model/entities';
import { autosize } from './notes-layout';
import { FileMenu, ReferenceLayer } from './ReferenceLayer';

/** The files a note's `@` lists at most. */
const MENU_ROWS = 8;

/**
 * A note's text field with its references (`docs/features/note-references.md`): the files and
 * web addresses in it tinted, from a layer over the field that takes no pointer, as the field
 * stays plain text; `⌘`-click (Ctrl elsewhere) on one opens it. After `@` the folder's files that
 * match what follows are listed under it: `↑`/`↓` move, `↵` or `Tab` put the one chosen in its
 * place, `Esc` closes the list, a click picks. The field's own keys come after: `keyDown` says
 * whether the list took the key. Where the book's notes name no files, only addresses.
 */
export function useReferenceField({
    book,
    field,
    text,
    onText,
}: {
    book: string;
    field: RefObject<HTMLTextAreaElement | null>;
    text: string;
    /** The text changed by a suggestion picked, as typing would. */
    onText: (text: string) => void;
}) {
    const references = useNoteReferences();
    const filesOf = references.filesOf(book);
    const entities = useNoteEntities(book, text);
    const open = useOpenEntity(book);
    // where the caret is while the field has the focus, nothing selected
    const [caret, setCaret] = useState<number | null>(null);
    const typing = filesOf && caret !== null ? typingAt(text, caret) : null;
    // the reference whose list `Esc` or a pick closed, as it was then: typing in it opens it again
    const [closed, setClosed] = useState<string | null>(null);
    const listing = typing !== null && closed !== `${typing.start}:${typing.query}`;
    const query = typing?.query ?? '';
    const found = useQuery({
        queryKey: ['note-files', filesOf?.folder, query],
        queryFn: () => filesOf?.search(query) ?? Promise.resolve([]),
        enabled: listing,
        placeholderData: keepPreviousData,
        gcTime: 0,
    });
    const listed = listing
        ? (found.data ?? []).filter((file) => nameable(file.path)).slice(0, MENU_ROWS)
        : [];
    const [chosen, setChosen] = useState({ query: '', index: 0 });
    // the first is chosen again as what is typed changes
    const active = chosen.query === query ? Math.min(chosen.index, listed.length - 1) : 0;
    // the caret past a suggestion, once the field has its text
    const caretAfter = useRef<number | null>(null);
    useLayoutEffect(() => {
        const at = caretAfter.current;
        if (at === null || !field.current) return;
        caretAfter.current = null;
        field.current.setSelectionRange(at, at);
        autosize(field.current);
        setCaret(at);
    });

    const follow = (element: HTMLTextAreaElement) => {
        const { selectionStart, selectionEnd } = element;
        setCaret(selectionStart === selectionEnd ? selectionStart : null);
    };
    // the reference picked is done: its list stays closed, even with the caret still at its end
    // (before a closing bracket)
    const pick = (path: string) => {
        if (!typing) return;
        const next = withSuggestion(text, typing, path);
        caretAfter.current = next.caret;
        setClosed(`${typing.start}:${path}`);
        onText(next.text);
    };
    const listId = useId();
    const optionId = (index: number) => `${listId}-${index}`;

    return {
        entities,
        /** What the field takes, beside its own handlers. */
        field: {
            'aria-controls': listed.length > 0 ? listId : undefined,
            'aria-activedescendant': listed.length > 0 ? optionId(active) : undefined,
            onSelect: (event: { currentTarget: HTMLTextAreaElement }) =>
                follow(event.currentTarget),
            onBlur: () => setCaret(null),
            onClick: (event: MouseEvent<HTMLTextAreaElement>) => {
                if (!hasShortcutModifier(event)) return;
                const at = event.currentTarget.selectionStart;
                const entity = entities.find(({ start, end }) => at >= start && at <= end);
                if (!entity) return;
                event.preventDefault();
                open(entity);
            },
        },
        /**
         * Takes the list's keys while it shows, and `⌥↵` (Alt elsewhere) on a reference, which
         * opens the one at the caret, as `⌘`-click does; whether it took this one.
         */
        keyDown: (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
            if (event.nativeEvent.isComposing) return false;
            const altOnly = event.altKey && !event.shiftKey && !event.metaKey && !event.ctrlKey;
            if (altOnly && event.key === 'Enter') {
                const at = event.currentTarget.selectionStart;
                const entity = entities.find(({ start, end }) => at >= start && at <= end);
                if (!entity) return false;
                event.preventDefault();
                open(entity);
                return true;
            }
            if (listed.length === 0 || !typing) return false;
            const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
            if (step !== 0) {
                event.preventDefault();
                const index = (active + step + listed.length) % listed.length;
                setChosen({ query, index });
                return true;
            }
            // `⌘↵` closes the note, `⇧Tab` leaves the field: only the plain keys pick
            const plain = !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey;
            if (plain && (event.key === 'Enter' || event.key === 'Tab')) {
                event.preventDefault();
                const file = listed[active];
                if (file) pick(file.path);
                return true;
            }
            if (event.key === 'Escape') {
                // the field stays open, the workspace skips a key handled
                event.preventDefault();
                setClosed(`${typing.start}:${typing.query}`);
                return true;
            }
            return false;
        },
        /** The tint over the field and the list of files: beside the field, in its parent. */
        layer: (
            <ReferenceLayer field={field} text={text} entities={entities} anchor={typing}>
                {(anchor) =>
                    listed.length > 0 ? (
                        <FileMenu
                            id={listId}
                            optionId={optionId}
                            anchor={anchor}
                            files={listed}
                            active={active}
                            onChoose={(index) => setChosen({ query, index })}
                            onPick={pick}
                        />
                    ) : null
                }
            </ReferenceLayer>
        ),
    };
}
