import { Menu } from '@base-ui/react/menu';
import { IconDots, IconPencil, IconPlus, IconTrash } from '@tabler/icons-react';
import {
    type KeyboardEvent,
    lazy,
    type ReactNode,
    Suspense,
    useEffect,
    useRef,
    useState,
} from 'react';
import { useTranslation } from '@/shared/i18n';
import type { SummaryPart } from '@/shared/panels/panel';
import { type ProjectInfo, projectFolder } from '@/shared/projects/project-info';
import { placeName } from '@/shared/projects/project-place';
import { RemoteTag } from '@/shared/projects/RemoteTag';
import { ZOOM_NAMES } from '@/shared/ui/zoom-transition';
import type { FolderChoice, ProjectList } from '../model/project.types';
import { ProjectAvatar } from './ProjectAvatar';

/** Loaded when first asked for: the first paint does not show it. */
const NewProjectDialog = lazy(() =>
    import('./NewProjectDialog').then((module) => ({ default: module.NewProjectDialog })),
);

const GRID_KEYS: Record<string, 'left' | 'right' | 'up' | 'down'> = {
    ArrowLeft: 'left',
    ArrowRight: 'right',
    ArrowUp: 'up',
    ArrowDown: 'down',
};

/**
 * Moves the focus among the cards (and "New project") with the arrows, row by row as the grid
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
 * Level 0: one card per project, doubling as the project switcher, the "+ New project" card last
 * (alone without projects), which opens the New project dialog; a card's ⋯ edits (name, folders)
 * or removes. It opens with the focus on the project on screen, so `↵` goes back to it and the
 * arrows start from it. It fills the room beside it down to one column of
 * cards: what is beside gives way then.
 */
export function ProjectsOverview({
    list,
    zoomed,
    onOpen,
    onEdit,
    onRemove,
    summary,
    asked,
    onAskedTaken,
}: {
    list: ProjectList;
    /** The project whose card the zoom to its panels grows from, and back into. */
    zoomed: string | null;
    /** A project was picked or made: the app shows it, asking first which folder of several. */
    onOpen: (projectId: string) => void;
    /** A project's name and folders to change: the app opens its dialog. */
    onEdit: (project: ProjectInfo) => void;
    /** A project's removal asked for: the app asks what to do with what it holds, then removes. */
    onRemove: (project: ProjectInfo) => void;
    /** What the panels tell about a project, below its name, part by part. */
    summary: (project: ProjectInfo, part: SummaryPart) => ReactNode;
    /** A folder given on the command line to ask about: the New project dialog opens on it. */
    asked: FolderChoice | null;
    /** The dialog took `asked`. */
    onAskedTaken: () => void;
}) {
    const { t } = useTranslation();
    // the New project dialog open, on a folder already picked or none
    const [creating, setCreating] = useState<{ picked: FolderChoice | null } | null>(null);
    useEffect(() => {
        if (!asked) return;
        setCreating({ picked: asked });
        onAskedTaken();
    }, [asked, onAskedTaken]);
    const grid = useRef<HTMLDivElement>(null);

    useEffect(() => {
        grid.current?.querySelector<HTMLElement>('[data-current-card]')?.focus();
    }, []);

    return (
        <section
            aria-label={t('common.allProjects')}
            // a card's least width, the grid's column and the least the overview takes with its
            // padding
            className="h-full min-w-[calc(var(--card-min)+2rem)] flex-1 overflow-auto p-4 [--card-min:300px]"
        >
            <div
                ref={grid}
                className="grid grid-cols-[repeat(auto-fill,minmax(var(--card-min),1fr))] gap-4"
                onKeyDown={moveInGrid}
            >
                {list.projects.map((project) => (
                    <ProjectCard
                        key={project.id}
                        project={project}
                        selected={project.id === list.active}
                        zoomed={project.id === zoomed}
                        onOpen={() => onOpen(project.id)}
                        onEdit={() => onEdit(project)}
                        onRemove={() => onRemove(project)}
                        summary={(part) => summary(project, part)}
                    />
                ))}
                <button
                    type="button"
                    data-grid-cell
                    className="flex min-h-44 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-ui-border p-4 text-center text-ui-text-muted transition-colors hover:border-ui-border-hover hover:text-ui-text-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ui-accent"
                    onClick={() => setCreating({ picked: null })}
                >
                    <span className="flex items-center gap-2 text-sm">
                        <IconPlus size={16} />
                        {t('projects.new')}
                    </span>
                    <span className="text-xs">{t('projects.newHint')}</span>
                </button>
            </div>
            {creating ? (
                <Suspense fallback={null}>
                    <NewProjectDialog
                        picked={creating.picked}
                        onCreated={onOpen}
                        onOpenProject={onOpen}
                        onClose={() => setCreating(null)}
                    />
                </Suspense>
            ) : null}
        </section>
    );
}

function ProjectCard({
    project,
    selected,
    zoomed,
    onOpen,
    onEdit,
    onRemove,
    summary,
}: {
    project: ProjectInfo;
    selected: boolean;
    /** The zoom to the project's panels grows from this card, or back into it. */
    zoomed: boolean;
    onOpen: () => void;
    onEdit: () => void;
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
                            <Menu.Item className="menu-item" onClick={onEdit}>
                                <IconPencil size={14} />
                                {t('projects.editMenu')}
                            </Menu.Item>
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
