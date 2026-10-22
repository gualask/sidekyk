import type { ProjectLocation } from './project-info';
import { remoteName } from './project-place';

/** The machine a project's folder is on, next to its name or folder, when it is not this one. */
export function RemoteTag({
    folder,
    className = '',
}: {
    folder: ProjectLocation | null;
    className?: string;
}) {
    const name = folder ? remoteName(folder) : null;
    return name ? (
        <span className={`chip shrink-0 whitespace-nowrap ${className}`}>{name}</span>
    ) : null;
}
