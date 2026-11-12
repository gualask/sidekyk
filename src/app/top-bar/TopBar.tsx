import { IconHelp, IconSearch, IconSettings } from '@tabler/icons-react';
import { lazy, Suspense } from 'react';
import { ProjectFacts } from '@/modules/repository';
import { useTranslation } from '@/shared/i18n';
import type { PanelDefinition } from '@/shared/panels/panel';
import { withKeys } from '@/shared/platform/keys';
import type { ProjectFolder, ProjectInfo } from '@/shared/projects/project-info';
import { RemoteTag } from '@/shared/projects/RemoteTag';
import { KeyCap } from '@/shared/ui/KeyCaps';
import { ZOOM_NAMES } from '@/shared/ui/zoom-transition';
import { panelShortcut } from '../panels';
import type { Problem } from '../problems';
import { useTitleBarOverlaid } from '../providers';
import type { ZoomLevel } from '../workspace';
import { FolderMenu } from './FolderMenu';

/** Loaded with the first problem: most sessions have none. */
const ProblemsButton = lazy(() =>
    import('./ProblemsButton').then((module) => ({ default: module.ProblemsButton })),
);

/**
 * The window's top bar: where you are (all projects, a project, a panel), the way back, the
 * panels minimized, the command palette, the problems that last, if any, the settings and the shortcuts. On macOS it is also the
 * title bar: the traffic lights sit in its first 78 pixels, and its empty parts drag the window.
 */
export function TopBar({
    level,
    project,
    folder,
    panel,
    problems,
    onZoom,
    onOpenSettings,
    onOpenPalette,
    helpOpen,
    onToggleHelp,
    minimized,
    onRestore,
    facts,
    onShowFolder,
    onEditFolders,
}: {
    level: ZoomLevel;
    project: ProjectInfo | null;
    /** The project's folder on screen; null without folder. */
    folder: ProjectFolder | null;
    panel: PanelDefinition;
    problems: Problem[];
    onZoom: (level: ZoomLevel) => void;
    onOpenSettings: () => void;
    onOpenPalette: () => void;
    helpOpen: boolean;
    onToggleHelp: () => void;
    /** The panels waiting in the top bar, at a project's panels. */
    minimized: readonly PanelDefinition[];
    onRestore: (panel: PanelDefinition) => void;
    /** A project's panels are on screen, Changes among them: its snapshot has the facts. */
    facts: boolean;
    /** Shows another folder of the project on screen. */
    onShowFolder: (folderId: string) => void;
    /** Opens the project's name and folders, to change them. */
    onEditFolders: () => void;
}) {
    const { t } = useTranslation();
    const overlaid = useTitleBarOverlaid();

    return (
        <header
            data-tauri-drag-region
            className={`flex h-10 shrink-0 items-center gap-2.5 border-b border-ui-border bg-ui-surface pr-2.5 ${
                overlaid ? 'pl-[78px]' : 'pl-3.5'
            }`}
        >
            <Breadcrumb
                level={level}
                project={project}
                folder={folder}
                panel={panel}
                onZoom={onZoom}
                onShowFolder={onShowFolder}
                onEditFolders={onEditFolders}
            />
            {folder && facts ? <ProjectFacts folder={folder} fromSnapshot /> : null}
            <div className="ml-auto flex items-center gap-1.5">
                {minimized.length > 0 ? (
                    <MinimizedChips minimized={minimized} onRestore={onRestore} />
                ) : null}
                <button
                    type="button"
                    className="flex h-[26px] items-center gap-1.5 rounded-[7px] border border-ui-border pr-1.5 pl-2 text-xs text-ui-text-muted transition-colors hover:border-ui-border-hover hover:text-ui-text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-accent-muted"
                    title={t('topBar.goToTitle')}
                    aria-label={t('common.goTo')}
                    onClick={onOpenPalette}
                >
                    <IconSearch size={13} />
                    <KeyCap keys="Mod+K" />
                </button>
                {problems.length > 0 ? (
                    <Suspense fallback={null}>
                        <ProblemsButton problems={problems} />
                    </Suspense>
                ) : null}
                <button
                    type="button"
                    className="btn-icon h-7 w-7"
                    title={withKeys(t('topBar.settings'), 'Mod+,')}
                    aria-label={t('topBar.settings')}
                    onClick={onOpenSettings}
                >
                    <IconSettings size={16} />
                </button>
                <button
                    type="button"
                    className="btn-icon h-7 w-7"
                    title={`${t('common.shortcuts')} (?)`}
                    aria-label={t('common.shortcuts')}
                    aria-pressed={helpOpen}
                    onClick={onToggleHelp}
                >
                    <IconHelp size={16} />
                </button>
            </div>
        </header>
    );
}

/** Where you are: all projects, the project and its folder on screen, the panel full screen. */
function Breadcrumb({
    level,
    project,
    folder,
    panel,
    onZoom,
    onShowFolder,
    onEditFolders,
}: {
    level: ZoomLevel;
    project: ProjectInfo | null;
    folder: ProjectFolder | null;
    panel: PanelDefinition;
    onZoom: (level: ZoomLevel) => void;
    onShowFolder: (folderId: string) => void;
    onEditFolders: () => void;
}) {
    const { t } = useTranslation();
    const separator = <span className="font-normal text-ui-text-muted">/</span>;
    return (
        <nav
            aria-label={t('topBar.whereYouAre')}
            className="flex min-w-0 items-center gap-1.5 text-sm font-semibold"
        >
            <Crumb onClick={level === 0 ? undefined : () => onZoom(0)}>
                {t('common.allProjects')}
            </Crumb>
            {project && level >= 1 ? (
                <>
                    {separator}
                    <Crumb onClick={level === 1 ? undefined : () => onZoom(1)}>
                        {project.name}
                    </Crumb>
                    <RemoteTag folder={folder} />
                </>
            ) : null}
            {project && folder && level >= 1 && project.folders.length > 1 ? (
                <>
                    {separator}
                    <FolderMenu
                        project={project}
                        folder={folder}
                        onShow={onShowFolder}
                        onEdit={onEditFolders}
                    />
                </>
            ) : null}
            {level === 2 ? (
                <>
                    {separator}
                    <Crumb>{t(panel.title)}</Crumb>
                </>
            ) : null}
        </nav>
    );
}

/** A step of the breadcrumb: where you are, or a button back to it. */
function Crumb({ onClick, children }: { onClick?: () => void; children: string }) {
    if (!onClick) {
        return (
            <span className="truncate px-1.5 py-1" aria-current="location">
                {children}
            </span>
        );
    }
    return (
        <button
            type="button"
            className="truncate rounded-md px-1.5 py-1 hover:bg-ui-surface-hover focus-visible:outline-2 focus-visible:outline-ui-accent"
            onClick={onClick}
        >
            {children}
        </button>
    );
}

/** The panels waiting in the top bar, each a chip that brings its tile back. */
function MinimizedChips({
    minimized,
    onRestore,
}: {
    minimized: readonly PanelDefinition[];
    onRestore: (panel: PanelDefinition) => void;
}) {
    const { t } = useTranslation();
    return (
        <nav className="mr-1 flex items-center gap-1.5" aria-label={t('topBar.minimized')}>
            {minimized.map((panel) => (
                <button
                    key={panel.id}
                    type="button"
                    // the chip and the tile are one element to the eye: the zoom flies one
                    // into the other
                    style={{ viewTransitionName: ZOOM_NAMES.panel(panel.id) }}
                    className="flex h-[26px] items-center gap-1.5 rounded-[7px] border border-ui-border bg-ui-surface-subtle px-2.5 text-xs font-semibold text-ui-text-secondary hover:border-ui-border-hover hover:text-ui-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-accent-muted"
                    // a tile that waits there is a side one, which a key opens
                    title={t('topBar.restore', {
                        panel: t(panel.title),
                        key: panelShortcut(panel) ?? '',
                    })}
                    onClick={() => onRestore(panel)}
                >
                    <panel.icon size={13} stroke={1.75} className="text-ui-text-muted" />
                    {t(panel.title)}
                </button>
            ))}
        </nav>
    );
}
