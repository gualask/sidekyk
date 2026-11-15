import { Autocomplete } from '@base-ui/react/autocomplete';
import { useMemo, useRef, useState } from 'react';
import { FOLDER_COLUMNS, FolderFacts } from '@/modules/repository';
import { useNameRanking } from '@/modules/search';
import { useTranslation } from '@/shared/i18n';
import { FolderPath } from '@/shared/projects/FolderPath';
import type { ProjectFolder, ProjectInfo } from '@/shared/projects/project-info';
import { folderName, placeName } from '@/shared/projects/project-place';
import { PickerDialog, PickerField, PickerKeys } from '@/shared/ui/PickerDialog';

/**
 * Which folder a project of several opens on, asked each time it is entered: its folders in the
 * project's order, each with its place, branch and what changed; the first chosen, so the same
 * keys always reach the same folder (`↵ ↵` its first). Typing narrows them, ranked as the palette
 * ranks names. `Esc` leaves everything as it was. Loaded while the window is idle.
 */
export function FolderPicker({
    project,
    onPick,
    onClose,
}: {
    project: ProjectInfo;
    onPick: (folderId: string) => void;
    onClose: () => void;
}) {
    const { t } = useTranslation();
    const input = useRef<HTMLInputElement>(null);
    const [query, setQuery] = useState('');
    const names = useMemo(() => project.folders.map(folderName), [project.folders]);
    const { order, pending } = useNameRanking(query, names);
    const folders = order ? order.map((index) => project.folders[index]) : project.folders;
    return (
        <PickerDialog
            onOpenChange={(open) => {
                if (!open) onClose();
            }}
            title={t('projects.pickTitle', { name: project.name })}
            initialFocus={input}
            width="w-[min(640px,calc(100vw-32px))]"
        >
            <Autocomplete.Root
                open
                inline
                items={folders}
                filter={null}
                value={query}
                onValueChange={setQuery}
                itemToStringValue={(folder: ProjectFolder) => folderName(folder)}
                autoHighlight="always"
            >
                <PickerField
                    pending={pending}
                    ref={input}
                    aria-label={t('projects.pickFilter')}
                    placeholder={t('projects.pickFilter')}
                />
                {folders.length === 0 ? (
                    <div className="px-4 py-8 text-center text-[13px] text-ui-text-muted">
                        {t('common.nothingFound')}
                    </div>
                ) : null}
                <Autocomplete.List className="max-h-[50vh] min-h-0 overflow-auto overscroll-contain px-1.5 pb-1.5 empty:hidden">
                    {folders.map((folder, index) => (
                        <Autocomplete.Item
                            key={folder.id}
                            value={folder}
                            index={index}
                            onClick={() => onPick(folder.id)}
                            className={`pick-row group ${FOLDER_COLUMNS} min-h-11 px-2.5 py-1.5`}
                        >
                            <span className="flex min-w-0 flex-col">
                                <span className="truncate">{folderName(folder)}</span>
                                <FolderPath path={placeName(folder)} />
                            </span>
                            <FolderFacts folder={folder} />
                        </Autocomplete.Item>
                    ))}
                </Autocomplete.List>
                <PickerKeys enter={t('common.enterOpens')} />
            </Autocomplete.Root>
        </PickerDialog>
    );
}
