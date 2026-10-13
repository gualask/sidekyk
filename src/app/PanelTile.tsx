import { IconArrowsMaximize } from '@tabler/icons-react';
import { Suspense, useState } from 'react';
import type { PanelDefinition, PanelTarget } from '@/shared/panels/panel';
import type { ProjectInfo } from '@/shared/projects/project-info';
import { ZOOM_NAMES } from '@/shared/ui/zoom-transition';
import { panelShortcut } from './panels';

/** A panel's header row, in a tile or full screen. */
const HEADER =
    'flex h-[34px] shrink-0 items-center gap-2 border-b border-ui-border text-[13px] whitespace-nowrap';

/**
 * A panel, in a tile (level 1) or full screen (level 2). Its header carries what the panel puts
 * there (what is open in it, its actions); a tile's also has the panel's title and the button that
 * zooms into it. Full screen the breadcrumb names the panel, so a panel with nothing to show in
 * its header has none.
 */
export function PanelTile({
    panel,
    project,
    target = null,
    onZoomIn,
}: {
    panel: PanelDefinition;
    project: ProjectInfo;
    /** What the panel is asked to show, if anything. */
    target?: PanelTarget | null;
    /** Shows the panel as a tile, whose header zooms into it; without it, the panel is full screen. */
    onZoomIn?: () => void;
}) {
    const shortcut = panelShortcut(panel);
    const [header, setHeader] = useState<HTMLElement | null>(null);

    return (
        <section
            aria-label={panel.title}
            data-panel={panel.id}
            // a tile zooms in on itself under the pointer (⌘+scroll), and grows to full screen
            data-zoom={onZoomIn ? '' : undefined}
            style={{ viewTransitionName: ZOOM_NAMES.panel(panel.id) }}
            className={`flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-ui-surface ${
                onZoomIn
                    ? 'rounded-xl border border-ui-border shadow-[0_1px_2px_var(--ui-shadow-soft)]'
                    : ''
            }`}
        >
            {onZoomIn ? (
                <div className={`${HEADER} pr-2 pl-3`}>
                    <span className="font-bold" title={`${panel.title} (${shortcut})`}>
                        {panel.title}
                    </span>
                    {/* parts the title from what the panel shows, while it shows something */}
                    <span className="h-4 w-px shrink-0 bg-ui-border has-[+div:empty]:hidden" />
                    <div ref={setHeader} className="contents" />
                    <button
                        type="button"
                        data-zoom-in
                        className="btn-icon ml-auto h-[26px] w-[26px]"
                        title={`Zoom into ${panel.title} (${shortcut})`}
                        aria-label={`Zoom into ${panel.title}`}
                        onClick={onZoomIn}
                    >
                        <IconArrowsMaximize size={14} />
                    </button>
                </div>
            ) : (
                <div ref={setHeader} className={`${HEADER} px-3 empty:hidden`} />
            )}
            <div className="relative min-h-0 flex-1">
                <Suspense fallback={null}>
                    <panel.Component
                        key={project.root}
                        project={project}
                        header={header}
                        target={target}
                    />
                </Suspense>
            </div>
        </section>
    );
}
