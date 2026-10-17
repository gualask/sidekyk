import { IconHelp, IconSearch, IconSettings } from '@tabler/icons-react';
import { lazy, Suspense } from 'react';
import { ProjectFacts } from '@/modules/repository';
import type { PanelDefinition } from '@/shared/panels/panel';
import { shortcutLabel } from '@/shared/platform/shortcut';
import type { ProjectInfo } from '@/shared/projects/project-info';
import type { Problem } from './problems';
import { useTitleBarOverlaid } from './providers';
import type { ZoomLevel } from './workspace';

/** Loaded with the first problem: most sessions have none. */
const ProblemsButton = lazy(() =>
    import('./ProblemsButton').then((module) => ({ default: module.ProblemsButton })),
);

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

/**
 * The window's top bar: where you are (all projects, a project, a panel), the way back, the
 * command palette, the problems that last, if any, the settings and the shortcuts. On macOS it is also the
 * title bar: the traffic lights sit in its first 78 pixels, and its empty parts drag the window.
 */
export function TopBar({
    level,
    project,
    panel,
    problems,
    onZoom,
    onOpenSettings,
    onOpenPalette,
    helpOpen,
    onToggleHelp,
}: {
    level: ZoomLevel;
    project: ProjectInfo | null;
    panel: PanelDefinition;
    problems: Problem[];
    onZoom: (level: ZoomLevel) => void;
    onOpenSettings: () => void;
    onOpenPalette: () => void;
    helpOpen: boolean;
    onToggleHelp: () => void;
}) {
    const overlaid = useTitleBarOverlaid();
    const separator = <span className="font-normal text-ui-text-muted">/</span>;

    return (
        <header
            data-tauri-drag-region
            className={`flex h-10 shrink-0 items-center gap-2.5 border-b border-ui-border bg-ui-surface pr-2.5 ${
                overlaid ? 'pl-[78px]' : 'pl-3.5'
            }`}
        >
            {project ? (
                <nav
                    aria-label="Where you are"
                    className="flex min-w-0 items-center gap-1.5 text-sm font-semibold"
                >
                    <Crumb onClick={level === 0 ? undefined : () => onZoom(0)}>All projects</Crumb>
                    {level >= 1 ? (
                        <>
                            {separator}
                            <Crumb onClick={level === 1 ? undefined : () => onZoom(1)}>
                                {project.name}
                            </Crumb>
                        </>
                    ) : null}
                    {level === 2 ? (
                        <>
                            {separator}
                            <Crumb>{panel.title}</Crumb>
                        </>
                    ) : null}
                </nav>
            ) : null}
            {project && level >= 1 ? (
                // a project's panels are on screen, Changes among them: its snapshot has the facts
                <ProjectFacts project={project} fromSnapshot />
            ) : null}
            <div className="ml-auto flex items-center gap-1.5">
                <button
                    type="button"
                    className="flex h-[26px] items-center gap-1.5 rounded-[7px] border border-ui-border pr-1.5 pl-2 text-xs text-ui-text-muted transition-colors hover:border-ui-border-hover hover:text-ui-text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-accent-muted"
                    title="Go to a project, a panel or a file"
                    aria-label="Go to"
                    onClick={onOpenPalette}
                >
                    <IconSearch size={13} />
                    <kbd className="kbd">{shortcutLabel('K')}</kbd>
                </button>
                {problems.length > 0 ? (
                    <Suspense fallback={null}>
                        <ProblemsButton problems={problems} />
                    </Suspense>
                ) : null}
                <button
                    type="button"
                    className="btn-icon h-7 w-7"
                    title={`Settings (${shortcutLabel(',')})`}
                    aria-label="Settings"
                    onClick={onOpenSettings}
                >
                    <IconSettings size={16} />
                </button>
                <button
                    type="button"
                    className="btn-icon h-7 w-7"
                    title="Shortcuts (?)"
                    aria-label="Shortcuts"
                    aria-pressed={helpOpen}
                    onClick={onToggleHelp}
                >
                    <IconHelp size={16} />
                </button>
            </div>
        </header>
    );
}
