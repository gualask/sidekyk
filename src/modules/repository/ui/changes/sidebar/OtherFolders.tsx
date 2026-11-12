import { IconArrowRight } from '@tabler/icons-react';
import { useTranslation } from '@/shared/i18n';
import type { ProjectFolder, ProjectInfo } from '@/shared/projects/project-info';
import { folderName } from '@/shared/projects/project-place';
import { useRepositorySummaries } from '../../../application/queries/snapshot';

/**
 * Under a folder clean, the project's other repositories with changes, each a button to show it:
 * an agent at work in `web` while `api` is on screen. Read as they show (an old read again), never
 * starting a stopped WSL distro; no watcher.
 */
export function OtherFolders({
    project,
    folder,
    onShow,
}: {
    project: ProjectInfo;
    folder: ProjectFolder;
    onShow: (folderId: string) => void;
}) {
    const { tp } = useTranslation();
    const others = useRepositorySummaries(project.folders.filter((f) => f.id !== folder.id));
    const changed = others.filter(({ summary }) => (summary.data?.totals.files ?? 0) > 0);
    if (changed.length === 0) return null;
    return (
        <div className="flex flex-col items-center gap-1">
            {changed.map(({ folder: other, summary }) => (
                <button
                    key={other.id}
                    type="button"
                    className="btn-ghost-sm flex items-center gap-1.5"
                    onClick={() => onShow(other.id)}
                >
                    {tp('changes.otherFolder', summary.data?.totals.files ?? 0, {
                        name: folderName(other),
                    })}
                    <IconArrowRight size={13} />
                </button>
            ))}
        </div>
    );
}
