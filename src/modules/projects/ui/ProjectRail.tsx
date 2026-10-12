import { IconLayoutGrid } from '@tabler/icons-react';
import type { ReactNode } from 'react';
import type { ProjectInfo } from '@/shared/projects/project-info';
import { useActivateProject } from '../application/projects.queries';
import type { ProjectList } from '../model/project.types';
import { ProjectAvatar } from './ProjectAvatar';

/** The projects on the left of a project: switching does not need a trip to all projects. */
export function ProjectRail({
    list,
    onShowAll,
    badge,
}: {
    list: ProjectList;
    onShowAll: () => void;
    /** What sits on a project's avatar, such as how many files changed in it. */
    badge: (project: ProjectInfo) => ReactNode;
}) {
    const activate = useActivateProject();

    return (
        <nav
            aria-label="Projects"
            className="flex w-14 shrink-0 flex-col items-center gap-2 overflow-y-auto border-r border-ui-border bg-ui-surface py-2.5"
        >
            <button
                type="button"
                className="btn-icon h-[34px] w-[34px]"
                title="All projects"
                aria-label="All projects"
                onClick={onShowAll}
            >
                <IconLayoutGrid size={18} stroke={1.75} />
            </button>
            <span className="h-px w-6 shrink-0 bg-ui-border" />
            {list.projects.map((project) => {
                const on = project.root === list.active;
                return (
                    <button
                        key={project.root}
                        type="button"
                        className="group relative shrink-0 rounded-[9px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ui-accent"
                        title={project.name}
                        aria-current={on ? 'page' : undefined}
                        onClick={() => activate(project.root)}
                    >
                        <ProjectAvatar
                            project={project}
                            className={`h-[34px] w-[34px] text-sm transition-opacity ${
                                on
                                    ? 'opacity-100 shadow-[0_0_0_2px_var(--ui-surface),0_0_0_4px_var(--ui-accent)]'
                                    : 'opacity-55 group-hover:opacity-90'
                            }`}
                        />
                        <span className="sr-only">{project.name}</span>
                        {badge(project)}
                    </button>
                );
            })}
        </nav>
    );
}
