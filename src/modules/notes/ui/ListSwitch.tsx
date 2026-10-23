import { Popover } from '@base-ui/react/popover';
import { IconChevronDown } from '@tabler/icons-react';
import { useState } from 'react';
import { useTranslation } from '@/shared/i18n';
import type { NoteActions } from '../application/notes.queries';
import type { NoteList, ProjectNotes } from '../model/notes.types';
import { NoteLists } from './NoteLists';

/**
 * In a tile, the open list's name in the header: it opens the lists, as full screen has them on
 * the left (new, rename, delete included). Opening one closes them.
 */
export function ListSwitch({
    notes,
    list,
    actions,
    onOpen,
    onMove,
}: {
    notes: ProjectNotes;
    list: NoteList;
    actions: NoteActions;
    onOpen: (list: string, write: boolean) => void;
    onMove: (list: NoteList) => void;
}) {
    const [open, setOpen] = useState(false);
    const { t } = useTranslation();
    return (
        <Popover.Root open={open} onOpenChange={setOpen}>
            <Popover.Trigger
                className="group flex min-w-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-semibold text-ui-text-secondary outline-none hover:bg-ui-surface-hover hover:text-ui-text focus-visible:ring-2 focus-visible:ring-ui-accent-muted data-popup-open:bg-ui-surface-hover data-popup-open:text-ui-text"
                title={t('notes.switchList')}
            >
                <span className="truncate">{list.name}</span>
                <IconChevronDown
                    size={12}
                    className="shrink-0 text-ui-text-muted transition-transform group-data-popup-open:rotate-180 motion-reduce:transition-none"
                />
            </Popover.Trigger>
            <Popover.Portal>
                <Popover.Positioner sideOffset={4} align="start" collisionPadding={10}>
                    <Popover.Popup className="max-h-[min(420px,var(--available-height))] w-[260px] overflow-auto rounded-[10px] border border-ui-border-hover bg-ui-surface font-sans shadow-[0_12px_32px_var(--ui-shadow-soft)] outline-none">
                        <Popover.Title className="sr-only">{t('notes.lists')}</Popover.Title>
                        <NoteLists
                            notes={notes}
                            actions={actions}
                            onOpen={(id, write) => {
                                setOpen(false);
                                onOpen(id, write);
                            }}
                            onMove={(moved) => {
                                setOpen(false);
                                onMove(moved);
                            }}
                        />
                    </Popover.Popup>
                </Popover.Positioner>
            </Popover.Portal>
        </Popover.Root>
    );
}
