import { avatarColor, avatarLetters } from './avatar';
import type { ProjectInfo } from './project-info';

/** A project's avatar: its letters on its color. Its size and text size come from `className`. */
export function ProjectAvatar({
    project,
    className = '',
}: {
    project: Pick<ProjectInfo, 'name' | 'avatar'>;
    className?: string;
}) {
    return (
        <span
            aria-hidden="true"
            className={`grid shrink-0 place-items-center rounded-lg font-bold text-ui-accent-on-solid ${className}`}
            style={{ backgroundColor: avatarColor(project.avatar.color) }}
        >
            {avatarLetters(project)}
        </span>
    );
}
