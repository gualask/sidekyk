import { Menu } from '@base-ui/react/menu';
import { IconDots, IconPlus, IconTrash } from '@tabler/icons-react';
import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useTranslation } from '@/shared/i18n';
import type { SummaryPart } from '@/shared/panels/panel';
import { type ProjectInfo, projectFolder } from '@/shared/projects/project-info';
import { placeName } from '@/shared/projects/project-place';
import { RemoteTag } from '@/shared/projects/RemoteTag';
import { ZOOM_NAMES } from '@/shared/ui/zoom-transition';
import { useActivateProject, useAddProject } from '../application/projects.queries';
import type { ProjectList } from '../model/project.types';
import { ProjectAvatar } from './ProjectAvatar';

const GRID_KEYS: Record<string, 'left' | 'right' | 'up' | 'down'> = {
    ArrowLeft: 'left',
    ArrowRight: 'right',
    ArrowUp: 'up',
    ArrowDown: 'down',
};

/**
 * Moves the focus among the cards (and "Add a repository") with the arrows, row by row as the grid
 * lays them out.
 */
function moveInGrid(event: KeyboardEvent<HTMLElement>) {
    const direction = GRID_KEYS[event.key];
    if (!direction || event.metaKey || event.ctrlKey || event.altKey) return;
    const cells = [...event.currentTarget.querySelectorAll<HTMLElement>('[data-grid-cell]')];
    const at = cells.indexOf(document.activeElement as HTMLElement);
    if (at < 0) return;
    const columns = cells.filter((cell) => cell.offsetTop === cells[0].offsetTop).length;
    const step = { left: -1, right: 1, up: -columns, down: columns }[direction];
    const next = cells[at + step];
    event.preventDefault();
    next?.focus();
}

/**
 * Level 0: one card per project, doubling as the project switcher. Loaded on its first show, with
 * the menu component it needs. It opens with the focus on the project on screen, so `↵` goes
 * back to it and the arrows start from it.
 */
export function ProjectsOverview({
    list,
    onOpen,
    onRemove,
    summary,
}: {
    list: ProjectList;
    /** A project was picked or added: show it. */
    onOpen: () => void;
    /** A project's removal asked for: the app asks what to do with what it holds, then removes. */
    onRemove: (project: ProjectInfo) => void;
    /** What the panels tell about a project, below its name, part by part. */
    summary: (project: ProjectInfo, part: SummaryPart) => ReactNode;
}) {
    const add = useAddProject(onOpen);
    const { t } = useTranslation();
    const activate = useActivateProject();
    // the card the zoom grows from: the one being opened, else the project on screen
    const [opening, setOpening] = useState<string | null>(null);
    const zoomed = opening ?? list.active;
    const grid = useRef<HTMLDivElement>(null);

    useEffect(() => {
        grid.current?.querySelector<HTMLElement>('[data-current-card]')?.focus();
    }, []);

    return (
        <section aria-label={t('common.allProjects')} className="h-full overflow-auto p-4">
            <div
                ref={grid}
                className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4"
                onKeyDown={moveInGrid}
            >
                {list.projects.map((project) => (
                    <ProjectCard
                        key={project.id}
                        project={project}
                        selected={project.id === list.active}
                        zoomed={project.id === zoomed}
                        onOpen={() => {
                            // named before the zoom captures the screen it leaves
                            flushSync(() => setOpening(project.id));
                            activate(project.id);
                            onOpen();
                        }}
                        onRemove={() => onRemove(project)}
                        summary={(part) => summary(project, part)}
                    />
                ))}
                <button
                    type="button"
                    data-grid-cell
                    disabled={add.isPending}
                    className="flex min-h-44 items-center justify-center gap-2 rounded-xl border border-dashed border-ui-border text-sm text-ui-text-muted transition-colors hover:border-ui-border-hover hover:text-ui-text-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ui-accent disabled:opacity-40"
                    onClick={() => add.mutate()}
                >
                    <IconPlus size={16} />
                    {t('projects.add')}
                </button>
            </div>
        </section>
    );
}

function ProjectCard({
    project,
    selected,
    zoomed,
    onOpen,
    onRemove,
    summary,
}: {
    project: ProjectInfo;
    selected: boolean;
    /** The zoom to the project's panels grows from this card, or back into it. */
    zoomed: boolean;
    onOpen: () => void;
    onRemove: () => void;
    summary: (part: SummaryPart) => ReactNode;
}) {
    const { t } = useTranslation();
    const folder = projectFolder(project);
    return (
        <article
            data-zoom
            style={zoomed ? { viewTransitionName: ZOOM_NAMES.project } : undefined}
            className={`relative flex flex-col gap-4 rounded-xl border bg-ui-surface p-4 shadow-[0_1px_2px_var(--ui-shadow-soft)] transition-colors ${
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
                        data-grid-cell
                        data-zoom-in
                        data-current-card={selected ? '' : undefined}
                        className="block max-w-full truncate text-left text-[15px] font-bold after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-ui-accent"
                        // its overlay covers the card: the folder shows wherever the pointer rests
                        title={folder ? placeName(folder) : undefined}
                        onClick={onOpen}
                    >
                        {project.name}
                    </button>
                    <div className="flex min-w-0 items-center gap-1.5">
                        <RemoteTag folder={folder} className="h-4 px-1.5 text-[11px]" />
                        {summary('lead')}
                    </div>
                </div>
            </div>
            {/* empty while the summaries load, or when none has a number */}
            <div className="flex gap-1.5 empty:hidden">{summary('facts')}</div>
            {summary('body')}
            <Menu.Root>
                <Menu.Trigger
                    className="btn-icon absolute top-2 right-2 h-7 w-7 data-popup-open:bg-ui-surface-hover data-popup-open:text-ui-text"
                    title={t('common.more')}
                    aria-label={t('projects.moreFor', { name: project.name })}
                >
                    <IconDots size={16} />
                </Menu.Trigger>
                <Menu.Portal>
                    <Menu.Positioner sideOffset={4} align="end">
                        <Menu.Popup className="menu-popup">
                            <Menu.Item className="menu-item danger" onClick={onRemove}>
                                <IconTrash size={14} />
                                {t('common.remove')}
                            </Menu.Item>
                        </Menu.Popup>
                    </Menu.Positioner>
                </Menu.Portal>
            </Menu.Root>
        </article>
    );
}
