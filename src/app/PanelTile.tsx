import { IconArrowsMaximize } from '@tabler/icons-react';
import { Suspense } from 'react';
import type { PanelDefinition, PanelProject } from '@/shared/panels/panel';
import { panelShortcut } from './panels';

/**
 * A panel, in a tile (level 1) or full screen (level 2). A tile's header carries the panel's
 * title and the button that zooms into it; full screen the breadcrumb names the panel, so with
 * nothing else to show there is no header.
 */
export function PanelTile({
    panel,
    project,
    onZoomIn,
}: {
    panel: PanelDefinition;
    project: PanelProject;
    /** Shows the panel as a tile, whose header zooms into it; without it, the panel is full screen. */
    onZoomIn?: () => void;
}) {
    const shortcut = panelShortcut(panel);

    return (
        <section
            aria-label={panel.title}
            data-panel={panel.id}
            className={`flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-ui-surface ${
                onZoomIn
                    ? 'rounded-xl border border-ui-border shadow-[0_1px_2px_var(--ui-shadow-soft)]'
                    : ''
            }`}
        >
            {onZoomIn ? (
                <div className="flex h-[34px] shrink-0 items-center gap-2 border-b border-ui-border pr-2 pl-3 text-[13px] font-bold whitespace-nowrap">
                    <span title={`${panel.title} (${shortcut})`}>{panel.title}</span>
                    <span className="flex-1" />
                    <button
                        type="button"
                        className="btn-icon h-[26px] w-[26px]"
                        title={`Zoom into ${panel.title} (${shortcut})`}
                        aria-label={`Zoom into ${panel.title}`}
                        onClick={onZoomIn}
                    >
                        <IconArrowsMaximize size={14} />
                    </button>
                </div>
            ) : null}
            <div className="relative min-h-0 flex-1">
                <Suspense fallback={null}>
                    <panel.Component project={project} />
                </Suspense>
            </div>
        </section>
    );
}
