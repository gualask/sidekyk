import { avatarColor, avatarLetter } from '../model/avatar';
import type { ProjectInfo } from '../model/project.types';

export function ProjectAvatar({
    project,
    className = '',
}: {
    project: ProjectInfo;
    className?: string;
}) {
    return (
        <span
            aria-hidden="true"
            className={`grid shrink-0 place-items-center rounded-lg font-bold text-ui-accent-on-solid ${className}`}
            style={{ backgroundColor: avatarColor(project.root) }}
        >
            {avatarLetter(project.name)}
        </span>
    );
}
