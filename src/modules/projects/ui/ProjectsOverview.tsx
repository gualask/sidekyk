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
import { ProjectAvatar } from '@/shared/projects/ProjectAvatar';
import { type ProjectInfo, projectFolder } from '@/shared/projects/project-info';
import { placeName } from '@/shared/projects/project-place';
import { RemoteTag } from '@/shared/projects/RemoteTag';
import { ZOOM_NAMES } from '@/shared/ui/zoom-transition';
import type { FolderChoice, ProjectList } from '../model/project.types';

/** Loaded when first asked for: the first paint does not show it. */
const NewProjectDialog = lazy(() =>
    import('./NewProjectDialog').then((module) => ({ default: module.NewProjectDialog })),
);

/** The project on screen: a bar on the row's left edge, where one comes back from. */
const CURRENT =
    'before:absolute before:inset-y-2.5 before:left-0 before:w-[3px] before:rounded-full before:bg-ui-accent';

const LIST_KEYS: Record<string, 1 | -1> = { ArrowDown: 1, ArrowUp: -1 };

/** Moves the focus among the rows with the arrows. */
function moveInList(event: KeyboardEvent<HTMLElement>) {
    const step = LIST_KEYS[event.key];
    if (!step || event.metaKey || event.ctrlKey || event.altKey) return;
    const rows = [...event.currentTarget.querySelectorAll<HTMLElement>('[data-list-row]')];
    const at = rows.indexOf(document.activeElement as HTMLElement);
    if (at < 0) return;
    event.preventDefault();
    rows[at + step]?.focus();
}

/**
 * Level 0 beside the Inbox: a header with New project, which opens the New project dialog, then
 * a row per project on the window's background, set apart by a line, doubling as the project
 * switcher; a row's ⋯ edits (name, folders) or removes. It opens with the focus on the project on
 * screen, so `↵` goes back to it and the arrows start from it. It gives way first in a narrow
 * window.
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
    /** The project whose row the zoom to its panels grows from, and back into. */
    zoomed: string | null;
    /** A project was picked or made: the app shows it, asking first which folder of several. */
    onOpen: (projectId: string) => void;
    /** A project's name and folders to change: the app opens its dialog. */
    onEdit: (project: ProjectInfo) => void;
    /** A project's removal asked for: the app asks what to do with what it holds, then removes. */
    onRemove: (project: ProjectInfo) => void;
    /** What the panels tell about a project on its row, part by part. */
    summary: (project: ProjectInfo, part: SummaryPart) => ReactNode;
    /** A folder given on the command line to ask about: the New project dialog opens on it. */
    asked: FolderChoice | null;
    /** The dialog took `asked`. */
    onAskedTaken: () => void;
}) {
    const { t } = useTranslation();
    const [creating, setCreating] = useCreating(asked, onAskedTaken);
    const rows = useRef<HTMLUListElement>(null);

    useEffect(() => {
        rows.current?.querySelector<HTMLElement>('[data-current-row]')?.focus();
    }, []);

    return (
        <section
            aria-label={t('common.allProjects')}
            className="h-full min-w-80 flex-1 overflow-auto px-4 pb-4"
        >
            <div className="max-w-3xl">
                <header className="flex items-center justify-between gap-3 pt-3.5 pb-2">
                    <h2 className="text-[15px] font-bold">{t('projects.title')}</h2>
                    <button
                        type="button"
                        className="btn-ghost-sm"
                        title={t('projects.newHint')}
                        onClick={() => setCreating({ picked: null })}
                    >
                        <IconPlus size={14} />
                        {t('projects.new')}
                    </button>
                </header>
                {list.projects.length === 0 ? (
                    <p className="text-xs text-ui-text-muted">{t('projects.newHint')}</p>
                ) : null}
                <ul
                    ref={rows}
                    className="divide-y divide-ui-border border-y border-ui-border"
                    onKeyDown={moveInList}
                >
                    {list.projects.map((project) => (
                        <li key={project.id}>
                            <ProjectRow
                                project={project}
                                selected={project.id === list.active}
                                zoomed={project.id === zoomed}
                                onOpen={() => onOpen(project.id)}
                                onEdit={() => onEdit(project)}
                                onRemove={() => onRemove(project)}
                                summary={(part) => summary(project, part)}
                            />
                        </li>
                    ))}
                </ul>
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

/**
 * The New project dialog open, on a folder already picked or none: opened on `asked` as soon as
 * one comes.
 */
function useCreating(asked: FolderChoice | null, onAskedTaken: () => void) {
    const [creating, setCreating] = useState<{ picked: FolderChoice | null } | null>(null);
    useEffect(() => {
        if (!asked) return;
        setCreating({ picked: asked });
        onAskedTaken();
    }, [asked, onAskedTaken]);
    return [creating, setCreating] as const;
}

/**
 * A project: its avatar, its name and the line under it, then the week of commits at the row's
 * end. Tinted under the pointer; the project on screen marked by an accent bar on its left
 * edge.
 */
function ProjectRow({
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
    /** The zoom to the project's panels grows from this row, or back into it. */
    zoomed: boolean;
    onOpen: () => void;
    onEdit: () => void;
    onRemove: () => void;
    summary: (part: SummaryPart) => ReactNode;
}) {
    const folder = projectFolder(project);
    return (
        <article
            data-zoom
            style={zoomed ? { viewTransitionName: ZOOM_NAMES.project } : undefined}
            className={`group relative flex min-h-14 items-center gap-3 px-2 py-2 transition-colors hover:bg-ui-surface-hover ${
                selected ? CURRENT : ''
            }`}
        >
            <ProjectAvatar project={project} className="h-8 w-8 text-sm" />
            <div className="min-w-0 flex-1">
                {/* the name, cut before the machine it is on, which tells two `shop`s apart */}
                <div className="flex min-w-0 items-center gap-2">
                    {/* the whole row opens the project; its menu stays a button of its own */}
                    <button
                        type="button"
                        data-list-row
                        data-zoom-in
                        data-current-row={selected ? '' : undefined}
                        className="block min-w-0 truncate text-left text-sm font-semibold after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-ui-accent"
                        // its overlay covers the row: the folder shows wherever the pointer rests
                        title={folder ? placeName(folder) : undefined}
                        onClick={onOpen}
                    >
                        {project.name}
                    </button>
                    <RemoteTag folder={folder} className="h-4 px-1.5 text-[11px]" />
                </div>
                {/* empty while the summaries load, and for a project without folder */}
                <div className="flex min-w-0 items-center empty:hidden">{summary('lead')}</div>
            </div>
            {/* one width, so that the rows' ends line up */}
            <div className="w-32 shrink-0">{summary('end')}</div>
            <ProjectMenu name={project.name} onEdit={onEdit} onRemove={onRemove} />
        </article>
    );
}

/**
 * A row's ⋯, shown under the pointer or focused: edit the project's name and folders, or remove
 * it.
 */
function ProjectMenu({
    name,
    onEdit,
    onRemove,
}: {
    name: string;
    onEdit: () => void;
    onRemove: () => void;
}) {
    const { t } = useTranslation();
    return (
        <Menu.Root>
            <Menu.Trigger
                className="btn-icon relative h-7 w-7 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-popup-open:bg-ui-surface-hover data-popup-open:text-ui-text data-popup-open:opacity-100"
                title={t('common.more')}
                aria-label={t('projects.moreFor', { name })}
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
    );
}
