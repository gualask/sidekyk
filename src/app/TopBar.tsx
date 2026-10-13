import { IconSettings } from '@tabler/icons-react';
import { ProjectFacts } from '@/modules/changes';
import type { PanelDefinition } from '@/shared/panels/panel';
import { shortcutLabel } from '@/shared/platform/shortcut';
import type { ProjectInfo } from '@/shared/projects/project-info';
import { useTitleBarOverlaid } from './providers';
import type { ZoomLevel } from './workspace';

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
 * The window's top bar: where you are (all projects, a project, a panel), the way back, and the
 * settings. On macOS it is also the title bar: the traffic lights sit in its first 78 pixels, and
 * its empty parts drag the window.
 */
export function TopBar({
    level,
    project,
    panel,
    onZoom,
    onOpenSettings,
}: {
    level: ZoomLevel;
    project: ProjectInfo | null;
    panel: PanelDefinition;
    onZoom: (level: ZoomLevel) => void;
    onOpenSettings: () => void;
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
            <button
                type="button"
                className="btn-icon ml-auto h-7 w-7"
                title={`Settings (${shortcutLabel(',')})`}
                aria-label="Settings"
                onClick={onOpenSettings}
            >
                <IconSettings size={16} />
            </button>
        </header>
    );
}
