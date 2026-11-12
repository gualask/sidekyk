import { Menu } from '@base-ui/react/menu';
import { IconCheck, IconChevronDown, IconFolderCog } from '@tabler/icons-react';
import { FOLDER_COLUMNS, FolderFacts } from '@/modules/repository';
import { useTranslation } from '@/shared/i18n';
import type { ProjectFolder, ProjectInfo } from '@/shared/projects/project-info';
import { folderName, placeName } from '@/shared/projects/project-place';

/**
 * The breadcrumb's step for a project of several folders: the folder on screen, whose menu lists
 * them all, each with its branch and what changed (read when the menu opens), to show another; and
 * the project's folders to change. One folder on screen at a time.
 */
export function FolderMenu({
    project,
    folder,
    onShow,
    onEdit,
}: {
    project: ProjectInfo;
    folder: ProjectFolder;
    onShow: (folderId: string) => void;
    onEdit: () => void;
}) {
    const { t } = useTranslation();
    return (
        <Menu.Root>
            <Menu.Trigger
                className="flex min-w-0 items-center gap-1 rounded-md px-1.5 py-1 hover:bg-ui-surface-hover focus-visible:outline-2 focus-visible:outline-ui-accent data-popup-open:bg-ui-surface-hover"
                title={placeName(folder)}
                aria-label={t('topBar.folderOf', {
                    name: folderName(folder),
                    project: project.name,
                })}
            >
                <span className="truncate">{folderName(folder)}</span>
                <IconChevronDown size={13} className="shrink-0 text-ui-text-muted" />
            </Menu.Trigger>
            <Menu.Portal>
                <Menu.Positioner sideOffset={4} align="start">
                    <Menu.Popup className="menu-popup w-[36rem]">
                        <Menu.RadioGroup value={folder.id} onValueChange={onShow}>
                            {project.folders.map((each) => (
                                <Menu.RadioItem
                                    key={each.id}
                                    value={each.id}
                                    closeOnClick
                                    className="menu-item gap-2 py-1.5"
                                    title={placeName(each)}
                                >
                                    <span className="flex w-3.5 shrink-0 justify-center">
                                        <Menu.RadioItemIndicator>
                                            <IconCheck size={14} />
                                        </Menu.RadioItemIndicator>
                                    </span>
                                    <span className={`${FOLDER_COLUMNS} min-w-0 flex-1`}>
                                        <span className="truncate">{folderName(each)}</span>
                                        <FolderFacts folder={each} />
                                    </span>
                                </Menu.RadioItem>
                            ))}
                        </Menu.RadioGroup>
                        <Menu.Separator className="mx-1 my-1 h-px bg-ui-border" />
                        <Menu.Item className="menu-item gap-2" onClick={onEdit}>
                            <span className="flex w-3.5 shrink-0 justify-center">
                                <IconFolderCog size={14} />
                            </span>
                            {t('topBar.editFolders')}
                        </Menu.Item>
                    </Menu.Popup>
                </Menu.Positioner>
            </Menu.Portal>
        </Menu.Root>
    );
}
