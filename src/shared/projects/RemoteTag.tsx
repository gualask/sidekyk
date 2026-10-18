import type { ProjectLocation } from './project-info';
import { remoteName } from './project-place';

/** The machine a project is on, next to its name or folder, when it is not this one. */
export function RemoteTag({
    location,
    className = '',
}: {
    location: ProjectLocation;
    className?: string;
}) {
    const name = remoteName(location);
    return name ? (
        <span className={`chip shrink-0 whitespace-nowrap ${className}`}>{name}</span>
    ) : null;
}
