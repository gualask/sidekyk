import { Menu } from '@base-ui/react/menu';
import { IconDots, IconPlus, IconTrash } from '@tabler/icons-react';
import { errorMessage } from '@/shared/errors/app-error';
import {
    useActivateProject,
    useAddProject,
    useRemoveProject,
} from '../application/projects.queries';
import type { ProjectInfo, ProjectList } from '../model/project.types';
import { ProjectAvatar } from './ProjectAvatar';

/**
 * Level 0: one card per project, doubling as the project switcher. Loaded on its first show, with
 * the menu component it needs.
 */
export function ProjectsOverview({
    list,
    onOpen,
}: {
    list: ProjectList;
    /** A project was picked or added: show it. */
    onOpen: () => void;
}) {
    const add = useAddProject();
    const remove = useRemoveProject();
    const activate = useActivateProject();
    const failure = add.error ?? remove.error;

    return (
        <section aria-label="All projects" className="h-full overflow-auto p-4">
            {failure ? (
                <p role="alert" className="mb-3 text-sm text-ui-danger">
                    {errorMessage(failure)}
                </p>
            ) : null}
            <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4">
                {list.projects.map((project) => (
                    <ProjectCard
                        key={project.root}
                        project={project}
                        selected={project.root === list.active}
                        onOpen={() => {
                            activate(project.root);
                            onOpen();
                        }}
                        onRemove={() => remove.mutate(project.root)}
                    />
                ))}
                <button
                    type="button"
                    disabled={add.isPending}
                    className="flex min-h-24 items-center justify-center gap-2 rounded-xl border border-dashed border-ui-border text-sm text-ui-text-muted transition-colors hover:border-ui-border-hover hover:text-ui-text-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ui-accent disabled:opacity-40"
                    onClick={() =>
                        add.mutate(undefined, {
                            onSuccess: (added) => {
                                if (added) onOpen();
                            },
                        })
                    }
                >
                    <IconPlus size={16} />
                    Add a repository
                </button>
            </div>
        </section>
    );
}

function ProjectCard({
    project,
    selected,
    onOpen,
    onRemove,
}: {
    project: ProjectInfo;
    selected: boolean;
    onOpen: () => void;
    onRemove: () => void;
}) {
    return (
        <article
            className={`relative flex min-h-24 flex-col gap-3 rounded-xl border bg-ui-surface p-4 shadow-[0_1px_2px_var(--ui-shadow-soft)] transition-colors ${
                selected
                    ? 'border-ui-accent shadow-[0_0_0_3px_var(--ui-accent-soft),0_8px_24px_var(--ui-shadow-soft)]'
                    : 'border-ui-border hover:border-ui-border-hover'
            }`}
        >
            <div className="flex min-w-0 items-center gap-2.5 pr-8">
                <ProjectAvatar project={project} className="h-8 w-8 text-sm" />
                <div className="min-w-0 flex-1">
                    {/* the whole card opens the project; its menu stays a button of its own */}
                    <button
                        type="button"
                        className="block max-w-full truncate text-left text-[15px] font-bold after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-ui-accent"
                        onClick={onOpen}
                    >
                        {project.name}
                    </button>
                    <div
                        className="truncate font-mono text-xs text-ui-text-muted"
                        title={project.root}
                    >
                        {project.root}
                    </div>
                </div>
            </div>
            <Menu.Root>
                <Menu.Trigger
                    className="btn-icon absolute top-2 right-2 h-7 w-7 data-popup-open:bg-ui-surface-hover data-popup-open:text-ui-text"
                    title="More"
                    aria-label={`More for ${project.name}`}
                >
                    <IconDots size={16} />
                </Menu.Trigger>
                <Menu.Portal>
                    <Menu.Positioner sideOffset={4} align="end">
                        <Menu.Popup className="menu-popup">
                            <Menu.Item className="menu-item danger" onClick={onRemove}>
                                <IconTrash size={14} />
                                Remove
                            </Menu.Item>
                        </Menu.Popup>
                    </Menu.Positioner>
                </Menu.Portal>
            </Menu.Root>
        </article>
    );
}
