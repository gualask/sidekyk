import { IconPlus, IconTrash } from '@tabler/icons-react';
import { useState } from 'react';
import { useTranslation } from '@/shared/i18n';
import { InlineField } from '@/shared/ui/InlineField';
import type { NoteActions } from '../application/notes.queries';
import { openCounts } from '../model/notes';
import type { ProjectNotes } from '../model/notes.types';

/** The longest list name, as the backend keeps it (`MAX_LIST_NAME` in `book.rs`). */
const MAX_LIST_NAME = 200;

/**
 * The lists of a project: "New list" first, so it is never a scroll away, then the lists with
 * their open notes counted. A click opens one, a double click renames it, its trash deletes it
 * with its notes (the last list stays).
 */
export function NoteLists({
    notes,
    actions,
    onOpen,
}: {
    notes: ProjectNotes;
    actions: NoteActions;
    /** A list was opened, or made (`write`: its field takes the focus, for its first note). */
    onOpen: (list: string, write: boolean) => void;
}) {
    // 'new', or the id of the list being renamed
    const [naming, setNaming] = useState<string | null>(null);
    const counts = openCounts(notes.notes);
    const { t } = useTranslation();

    return (
        <nav className="flex flex-col gap-px p-1.5 text-[13px]" aria-label={t('notes.lists')}>
            {naming === 'new' ? (
                <NameField
                    initial=""
                    onEnd={(name) => {
                        setNaming(null);
                        if (name) {
                            void actions.addList(name).then((list) => {
                                if (list) onOpen(list.id, true);
                            });
                        }
                    }}
                />
            ) : (
                <button
                    type="button"
                    className="flex items-center gap-1.5 rounded-[7px] px-3 py-1.5 text-left text-ui-text-secondary hover:bg-ui-surface-hover"
                    onClick={() => setNaming('new')}
                >
                    <IconPlus size={13} />
                    {t('notes.newList')}
                </button>
            )}
            <div className="mx-1.5 my-1 h-px bg-ui-border" />
            {notes.lists.map((list) =>
                naming === list.id ? (
                    <NameField
                        key={list.id}
                        initial={list.name}
                        onEnd={(name) => {
                            setNaming(null);
                            if (name && name !== list.name) void actions.renameList(list.id, name);
                        }}
                    />
                ) : (
                    <div key={list.id} className="group/list relative">
                        <button
                            type="button"
                            className={`flex w-full items-center gap-2 rounded-[7px] py-1.5 pr-2 pl-3 text-left ${
                                list.id === notes.openList
                                    ? 'bg-ui-accent-soft font-semibold text-ui-accent-on-soft'
                                    : 'text-ui-text-secondary hover:bg-ui-surface-hover'
                            }`}
                            title={t('notes.renameHint')}
                            aria-current={list.id === notes.openList ? 'true' : undefined}
                            onClick={() => {
                                if (list.id !== notes.openList) actions.openList(list.id);
                                onOpen(list.id, false);
                            }}
                            onDoubleClick={() => setNaming(list.id)}
                        >
                            <span className="min-w-0 flex-1 truncate">{list.name}</span>
                            <span
                                className={`text-[11.5px] ${
                                    notes.lists.length > 1 ? 'group-hover/list:invisible' : ''
                                } ${list.id === notes.openList ? '' : 'text-ui-text-muted'}`}
                            >
                                {counts.get(list.id) || ''}
                            </span>
                        </button>
                        {notes.lists.length > 1 ? (
                            <button
                                type="button"
                                className="btn-icon absolute top-1/2 right-1.5 h-6 w-6 -translate-y-1/2 opacity-0 group-hover/list:opacity-100 focus-visible:opacity-100"
                                title={t('notes.deleteList')}
                                aria-label={t('notes.deleteListNamed', { list: list.name })}
                                onClick={() => void actions.deleteList(list.id)}
                            >
                                <IconTrash size={13} />
                            </button>
                        ) : null}
                    </div>
                ),
            )}
        </nav>
    );
}

/** A list's name being typed: `↵` or leaving keeps it, `Esc` drops it. */
function NameField({ initial, onEnd }: { initial: string; onEnd: (name: string | null) => void }) {
    const { t } = useTranslation();
    return (
        <InlineField
            initial={initial}
            onEnd={(name) => onEnd(name?.trim() || null)}
            spellCheck={false}
            placeholder={t('notes.listName')}
            aria-label={t('notes.listName')}
            maxLength={MAX_LIST_NAME}
            className="mx-0.5 my-px rounded-md border border-ui-accent bg-ui-surface px-2.5 py-[5px] text-[13px] outline-none"
        />
    );
}
