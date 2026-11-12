import { Autocomplete } from '@base-ui/react/autocomplete';
import { IconFolderCode, IconInbox, IconList, IconPlus } from '@tabler/icons-react';
import type { ReactNode } from 'react';
import { useTranslation } from '@/shared/i18n';
import { FolderPath } from '@/shared/projects/FolderPath';
import { RemoteTag } from '@/shared/projects/RemoteTag';
import type { MoveBook, MoveRow } from '../../model/destination';
import { INBOX_BOOK } from '../../model/notes.types';
import type { Destination } from './use-destination';

/** The suggestions: under the field (`inline`), or in its popup. A row acts as `↵` does. */
export function Suggestions({
    destination,
    inline,
    onEnter,
}: {
    destination: Destination;
    inline: boolean;
    onEnter: (row: MoveRow | null) => void;
}) {
    const { rows, shared } = destination;
    return (
        <Autocomplete.List
            className={
                inline
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
}

/** The suggestions' popup, above the field. */
export function SuggestionsPopup({ children }: { children: ReactNode }) {
    const { t } = useTranslation();
    return (
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
                    {children}
                </Autocomplete.Popup>
            </Autocomplete.Positioner>
        </Autocomplete.Portal>
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
