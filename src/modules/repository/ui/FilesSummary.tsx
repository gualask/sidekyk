import type { PanelSummaryProps } from '@/shared/panels/panel';
import { FolderPath } from '@/shared/projects/FolderPath';
import { projectFolder } from '@/shared/projects/project-info';

/**
 * What Files tells about a project on its card at all projects: the folder under its name, where
 * a repository shows its branch. Nothing for a repository, whose branch says more.
 */
export function FilesSummary({ project, part, repository }: PanelSummaryProps) {
    const folder = projectFolder(project);
    if (part !== 'lead' || repository || !folder) return null;
    return <FolderPath path={folder.root} />;
}
