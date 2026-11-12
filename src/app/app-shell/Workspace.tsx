import { Suspense } from 'react';
import { InboxColumn } from '@/modules/notes';
import {
    type FolderChoice,
    type ProjectList,
    ProjectsOverview,
    type TilesLayout,
} from '@/modules/projects';
import { useProjectKind } from '@/modules/repository';
import { useTranslation } from '@/shared/i18n';
import type { PanelDefinition, PanelProps, SummaryPart } from '@/shared/panels/panel';
import { onlyFolder, type ProjectFolder, type ProjectInfo } from '@/shared/projects/project-info';
import { remoteMachine } from '@/shared/projects/project-place';
import { Preloaded } from '@/shared/ui/Preloaded';
import { ZOOM_NAMES } from '@/shared/ui/zoom-transition';
import { type Asked, targetFor } from '../asked';
import { MAIN_TILE_MIN_WIDTH, type ProjectTiles, projectTiles, TILE_GAP } from '../panels';
import type { ZoomLevel } from '../workspace';
import { PanelTile } from '../workspace-view/PanelTile';
import { SideColumn } from '../workspace-view/SideColumn';

/** A project and its panels, at level 1 or full screen: the zoom carries it to and from its row. */
const PROJECT_ZOOM = { viewTransitionName: ZOOM_NAMES.project };

/** Level 1: the project's tiles, zoomed as the project. */
const TILES_STYLE = { ...PROJECT_ZOOM, gap: TILE_GAP };

/** The main tile fills what the side column leaves, keeping its least width while the window allows. */
const MAIN_SIZE = { flexGrow: 1, flexBasis: 0, minWidth: `min(${MAIN_TILE_MIN_WIDTH}px, 100%)` };

/** A tile of the side column fills its slot. */
const SIDE_SIZE = { flexGrow: 1, flexBasis: 0 };

/**
 * The workspace at its zoom level: all projects (the Inbox and the projects' rows), a project's
 * tiles, or one panel full screen.
 */
export function Workspace({
    list,
    zoomed,
    openProject,
    project,
    folder,
    tiles,
    level,
    panel,
    request,
    targetTaken,
    zoom,
    select,
    show,
    findInFiles,
    showFolder,
    layout,
    onSplit,
    onMinimize,
    onEdit,
    onRemove,
    asked,
    onAskedTaken,
    focusInbox,
    onInboxFocused,
    inboxNote,
    onInboxNoteRevealed,
}: {
    list: ProjectList;
    /** The project whose row the zoom grows from. */
    zoomed: string | null;
    /** Shows a project's panels, asking first which folder of several. */
    openProject: (projectId: string) => void;
    project: ProjectInfo | null;
    /** The project's folder on screen; null without folder. */
    folder: ProjectFolder | null;
    /** The project's panels; null with no project, or while its folder's kind is read. */
    tiles: ProjectTiles | null;
    level: ZoomLevel;
    /** Full screen at level 2 (and at level 1 with one panel), the selected tile at level 1. */
    panel: PanelDefinition;
    /** What a panel was asked to show, until it takes it. */
    request: Asked | null;
    targetTaken: PanelProps['targetTaken'];
    zoom: (level: ZoomLevel, panel?: PanelDefinition) => void;
    select: (panel: PanelDefinition) => void;
    show: PanelProps['show'];
    findInFiles: PanelProps['findInFiles'];
    showFolder: PanelProps['showFolder'];
    layout: TilesLayout;
    onSplit: (split: number) => void;
    onMinimize: (panel: PanelDefinition) => void;
    /** Asks to change a project's name and folders. */
    onEdit: (project: ProjectInfo) => void;
    /** Asks to remove a project. */
    onRemove: (project: ProjectInfo) => void;
    /** A folder given on the command line to ask about, until the New project dialog takes it. */
    asked: FolderChoice | null;
    onAskedTaken: () => void;
    /** The Inbox's field takes the focus. */
    focusInbox: boolean;
    onInboxFocused: () => void;
    /** An Inbox note to bring into view. */
    inboxNote: string | null;
    onInboxNoteRevealed: () => void;
}) {
    const targetOf = (id: string) =>
        targetFor(request, { project: project?.id ?? null, folder: folder?.id ?? null, panel: id });
    // all projects: the Inbox, then the projects' rows, which give way first in a narrow window
    if (!project || level === 0) {
        return (
            <div className="flex h-full">
                <InboxColumn
                    focusComposer={focusInbox}
                    onComposerFocused={onInboxFocused}
                    reveal={inboxNote}
                    onRevealed={onInboxNoteRevealed}
                />
                <ProjectsOverview
                    list={list}
                    zoomed={zoomed}
                    onOpen={openProject}
                    onEdit={onEdit}
                    onRemove={onRemove}
                    asked={asked}
                    onAskedTaken={onAskedTaken}
                    summary={(row, part) => (
                        <RowSummaries project={row} folder={onlyFolder(row)} part={part} />
                    )}
                />
            </div>
        );
    }
    if (!tiles) return <WaitingPanels folder={folder} />;
    // full screen, and a project's one panel at level 1
    if (level === 2 || tiles.side.length === 0) {
        return (
            <div className="flex h-full" style={PROJECT_ZOOM}>
                <PanelTile
                    panel={panel}
                    project={project}
                    folder={folder}
                    target={targetOf(panel.id)}
                    targetTaken={targetTaken}
                    selected
                    show={show}
                    findInFiles={findInFiles}
                    showFolder={showFolder}
                />
            </div>
        );
    }
    const { main } = tiles;
    // the side column's tiles not minimized; without them, the main tile takes the whole width
    const side = tiles.side.filter((tile) => !layout.minimized.includes(tile.id));
    return (
        <div className="flex h-full p-2" style={TILES_STYLE}>
            <PanelTile
                panel={main}
                project={project}
                folder={folder}
                target={targetOf(main.id)}
                targetTaken={targetTaken}
                selected={main === panel}
                show={show}
                findInFiles={findInFiles}
                showFolder={showFolder}
                tile={MAIN_SIZE}
                onZoomIn={() => zoom(2, main)}
                onSelect={() => select(main)}
            />
            {side.length > 0 ? (
                <SideColumn
                    panels={tiles.side}
                    shown={side}
                    split={layout.split}
                    onSplit={onSplit}
                    tile={(tile, tileFit) => (
                        <PanelTile
                            panel={tile}
                            project={project}
                            folder={folder}
                            target={targetOf(tile.id)}
                            targetTaken={targetTaken}
                            selected={tile === panel}
                            show={show}
                            findInFiles={findInFiles}
                            showFolder={showFolder}
                            tile={SIDE_SIZE}
                            tileFit={tileFit}
                            onZoomIn={() => zoom(2, tile)}
                            onMinimize={() => onMinimize(tile)}
                            onSelect={() => select(tile)}
                        />
                    )}
                />
            ) : null}
        </div>
    );
}

/**
 * What a project's panels tell on its row at all projects, from what its folder is: nothing until
 * that is read, which the rows ask without starting a WSL distro.
 */
function RowSummaries({
    project,
    folder,
    part,
}: {
    project: ProjectInfo;
    folder: ProjectFolder | null;
    part: SummaryPart;
}) {
    // a project of several folders has a repository's panels when one of them is
    const folderKind = useProjectKind(project.folders, { freshOnShow: true });
    if (folderKind.waiting) return null;
    const repository = folderKind.kind === 'repository';
    return projectTiles(folderKind.kind).summaries.map(({ id, summary }) => (
        <Suspense key={id} fallback={null}>
            <Preloaded of={summary} props={{ project, folder, part, repository }} />
        </Suspense>
    ));
}

/**
 * A project's panels before its folder's kind is read, as they wait for what they read: nothing
 * drawn, but for a WSL project, whose first read may start Sidekyk's helper in its distro.
 */
function WaitingPanels({ folder }: { folder: ProjectFolder | null }) {
    const { t } = useTranslation();
    const machine = folder ? remoteMachine(folder) : null;
    return (
        <div
            className="flex h-full items-center justify-center text-sm text-ui-text-muted"
            style={PROJECT_ZOOM}
        >
            {machine ? t('projects.starting', { distro: machine }) : null}
        </div>
    );
}
