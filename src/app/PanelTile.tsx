import { IconArrowsMaximize, IconMinus } from '@tabler/icons-react';
import { type CSSProperties, Suspense, useState } from 'react';
import type { PanelDefinition, PanelProps, PanelTarget } from '@/shared/panels/panel';
import type { ProjectInfo } from '@/shared/projects/project-info';
import { ZOOM_NAMES } from '@/shared/ui/zoom-transition';
import { panelShortcut } from './panels';

/** A panel's header row, in a tile or full screen. */
const HEADER =
    'flex h-[34px] shrink-0 items-center gap-2 border-b border-ui-border text-[13px] whitespace-nowrap';

/** Full screen, the panel takes the whole width. */
const FULL_WIDTH = { flexGrow: 1, flexBasis: 0 };

/**
 * A panel, in a tile (level 1) or full screen (level 2). Its header carries what the panel puts
 * there (what is open in it, its actions); a tile's also has the panel's icon, which names it in
 * its tooltip, and the button that zooms into it. Full screen the breadcrumb names the panel, so a panel with nothing to show in
 * its header has none.
 */
export function PanelTile({
    panel,
    project,
    target,
    selected,
    show,
    findInFiles,
    tile,
    tileFit = null,
    onZoomIn,
    onMinimize,
    onSelect,
}: {
    panel: PanelDefinition;
    project: ProjectInfo;
    /** What the panel is asked to show, if anything. */
    target: PanelTarget | null;
    /** The panel takes the keys: full screen, or the selected tile. */
    selected: boolean;
    show: PanelProps['show'];
    findInFiles: PanelProps['findInFiles'];
    /** The tile's size among a project's panels; none full screen. */
    tile?: CSSProperties;
    /** For a tile whose width the app sets: where the panel says how wide it needs it. */
    tileFit?: PanelProps['tileFit'];
    /** Shows the panel as a tile, whose header zooms into it; without it, the panel is full screen. */
    onZoomIn?: () => void;
    /** For a tile that can wait in the top bar: minimizes it there. */
    onMinimize?: () => void;
    /** Selects the tile, which then takes the keys. */
    onSelect?: () => void;
}) {
    const shortcut = panelShortcut(panel);
    const [header, setHeader] = useState<HTMLElement | null>(null);

    return (
        <section
            aria-label={panel.title}
            data-panel={panel.id}
            // a tile zooms in on itself under the pointer (⌘+scroll), and grows to full screen
            data-zoom={onZoomIn ? '' : undefined}
            style={{
                viewTransitionName: ZOOM_NAMES.panel(panel.id),
                ...(tile ?? FULL_WIDTH),
            }}
            // the tile clicked is the one the keys go to
            onPointerDownCapture={onSelect}
            className={`flex min-h-0 min-w-0 shrink-0 flex-col overflow-hidden bg-ui-surface ${
                !onZoomIn
                    ? ''
                    : selected
                      ? 'rounded-xl border border-ui-accent shadow-[0_0_0_3px_var(--ui-accent-soft)]'
                      : 'rounded-xl border border-ui-border shadow-[0_1px_2px_var(--ui-shadow-soft)]'
            }`}
        >
            {onZoomIn ? (
                <div className={`${HEADER} pr-2 pl-3`}>
                    {/* the panel's icon names it, its tooltip the title and the key that opens it */}
                    <span
                        role="img"
                        className="grid shrink-0 place-items-center text-ui-text-muted"
                        title={`${panel.title} (${shortcut})`}
                        aria-label={panel.title}
                    >
                        <panel.icon size={15} stroke={1.75} />
                    </span>
                    {/* parts the icon from what the panel shows, while it shows something */}
                    <span className="h-4 w-px shrink-0 bg-ui-border has-[+div:empty]:hidden" />
                    <div ref={setHeader} className="contents" />
                    {onMinimize ? (
                        <button
                            type="button"
                            className="btn-icon ml-auto h-[26px] w-[26px]"
                            title={`Minimize ${panel.title} to the top bar`}
                            aria-label={`Minimize ${panel.title}`}
                            onClick={onMinimize}
                        >
                            <IconMinus size={14} />
                        </button>
                    ) : null}
                    <button
                        type="button"
                        data-zoom-in
                        className={`btn-icon h-[26px] w-[26px] ${onMinimize ? '' : 'ml-auto'}`}
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
                        tileFit={tileFit}
                        target={target}
                        place={onZoomIn ? 'tile' : 'full'}
                        selected={selected}
                        show={show}
                        findInFiles={findInFiles}
                    />
                </Suspense>
            </div>
        </section>
    );
}
