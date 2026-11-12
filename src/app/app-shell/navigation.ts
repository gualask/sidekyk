import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react';
import type { ProjectList, TilesLayout } from '@/modules/projects';
import type { PanelDefinition, PanelProps, PanelTarget } from '@/shared/panels/panel';
import type { ProjectFolder, ProjectInfo } from '@/shared/projects/project-info';
import { zoomTransition } from '@/shared/ui/zoom-transition';
import { type Asked, taken } from '../asked';
import { deepestLevel, INITIAL_PANEL, type ProjectTiles, panelById, tileBeside } from '../panels';
import type { ZoomLevel } from '../workspace';

/** Where the window is, and every move from there. */
export type Navigation = ReturnType<typeof useNavigation>;

/**
 * Where the window is: its level, the panel full screen at level 2 and the tile selected at level
 * 1, and what a panel was asked to show, until it takes it; and every move among them, the tiles
 * that wait in the top bar included.
 */
export function useNavigation({
    list,
    project,
    folder,
    tiles,
    layout,
    changeLayout,
}: {
    list: ProjectList | undefined;
    project: ProjectInfo | null;
    /** The project's folder on screen; null without folder. */
    folder: ProjectFolder | null;
    /** The project's panels; null with no project, or while its folder's kind is read. */
    tiles: ProjectTiles | null;
    layout: TilesLayout;
    changeLayout: (next: (current: TilesLayout) => TilesLayout) => void;
}) {
    // the app opens at all projects, the one shown last selected; without projects it stays there
    const [zoomLevel, setLevel] = useState<ZoomLevel>(0);
    // the panel full screen at level 2, and the tile selected at level 1
    const [shownPanel, setPanel] = useState(INITIAL_PANEL);
    // what a panel was asked to show (a file picked in the palette), until it takes it
    const [request, setRequest] = useState<Asked | null>(null);
    const targetTaken = useCallback(
        (target: PanelTarget) => setRequest((current) => taken(current, target)),
        [],
    );
    // the level kept follows the one shown, so another project opens at the level seen
    const level = shownLevel(zoomLevel, project, folder, tiles);
    if (list && level !== zoomLevel) setLevel(level);
    // a panel the project does not have gives way to its main one
    const panel = tiles && !tiles.panels.includes(shownPanel) ? tiles.main : shownPanel;

    const unminimize = (tile: PanelDefinition) => {
        changeLayout((current) => ({
            ...current,
            minimized: current.minimized.filter((id) => id !== tile.id),
        }));
        setPanel(tile);
    };
    // a panel asked for that waits in the top bar comes back to take its request (a note found
    // at all projects, once its project's panels show): within the zoom still running, not in a
    // transition of its own, which would skip it
    // once for each request: one never taken (its panel failed to read) leaves the tile free to
    // go back to the top bar
    const bringBack = useEffectEvent((tile: PanelDefinition) => unminimize(tile));
    const broughtBack = useRef<Asked | null>(null);
    const askedTile = request?.project === project?.id && level === 1 ? request?.panel : null;
    const waiting = askedTile && layout.minimized.includes(askedTile) ? request : null;
    useEffect(() => {
        const tile = waiting ? panelById(waiting.panel) : undefined;
        if (!tile || broughtBack.current === waiting) return;
        broughtBack.current = waiting;
        bringBack(tile);
    }, [waiting]);
    // a tile minimized is not selected: the main one is, which is never minimized
    const selectedTile = tiles && layout.minimized.includes(panel.id) ? tiles.main : panel;

    /** A request to a panel of the project on screen, for its folder on screen. */
    const askOf = (panelId: string, target: PanelTarget): Asked | null =>
        project
            ? { project: project.id, folder: folder?.id ?? null, panel: panelId, target }
            : null;

    /**
     * Every change of level goes through here, so it animates the same way everywhere. A target
     * asks the panel full screen to show something, of the project on screen or of `of`, the one
     * being entered; it goes with the level, so a tile being left never takes it. Any other move
     * leaves the panels as they are, and forgets what was asked and not taken.
     */
    const zoom = (
        next: ZoomLevel,
        nextPanel = panel,
        nextTarget: PanelTarget | null = null,
        of: { project: string; folder: string | null } | null = null,
    ) => {
        const asked =
            nextTarget === null
                ? null
                : of
                  ? { ...of, panel: nextPanel.id, target: nextTarget }
                  : askOf(nextPanel.id, nextTarget);
        if (next === level && nextPanel === panel) {
            if (asked) setRequest(asked);
            return;
        }
        zoomTransition(() => {
            setLevel(next);
            setPanel(nextPanel);
            setRequest(asked);
        });
    };

    // a tile flies to its chip in the top bar, and back
    const minimize = (tile: PanelDefinition) =>
        zoomTransition(() => {
            changeLayout((current) => ({ ...current, minimized: [...current.minimized, tile.id] }));
            if (panel === tile && tiles) setPanel(tiles.main);
        });
    const restore = (tile: PanelDefinition) => zoomTransition(() => unminimize(tile));

    // a panel shows something in another: the other tile, selected (back from the top bar if it
    // waited there), or full screen in place of the first
    const show: PanelProps['show'] = (id, nextTarget) => {
        const next = panelById(id);
        if (!next || !project || !tiles?.panels.includes(next)) return;
        if (level === 2) {
            zoom(2, next, nextTarget);
            return;
        }
        if (layout.minimized.includes(next.id)) restore(next);
        else setPanel(next);
        setRequest(askOf(next.id, nextTarget));
    };

    return {
        level,
        /** Full screen at level 2 (and at level 1 with one panel), the tile selected at level 1. */
        panel,
        selectedTile,
        request,
        targetTaken,
        zoom,
        /**
         * A project's panels at the panel asked for, not the one the project at all projects
         * would show: a project of several folders, none picked, has Notes alone.
         */
        toPanels: () => zoom(1, shownPanel),
        zoomOut: () => {
            if (level > 0) zoom((level - 1) as ZoomLevel);
        },
        select: setPanel,
        show,
        minimize,
        restore,
        /** The arrows move among the tiles of a project's panels; false where there are none. */
        moveTile: (step: -1 | 1) => {
            const among = level === 1 && tiles && tiles.side.length > 0 ? tiles : null;
            const next = among
                ? tileBeside(among, selectedTile, step, layout.minimized)
                : undefined;
            if (next) setPanel(next);
            return among !== null;
        },
    };
}

/**
 * The level shown, from the one kept: as deep as the project goes. A project with one panel has no
 * level 2, and without projects, or with several folders none picked (one gone), only all
 * projects shows; while the panels wait, the level kept stays.
 */
function shownLevel(
    kept: ZoomLevel,
    project: ProjectInfo | null,
    folder: ProjectFolder | null,
    tiles: ProjectTiles | null,
): ZoomLevel {
    if (!project || (!folder && project.folders.length > 0)) return 0;
    return tiles ? (Math.min(kept, deepestLevel(tiles)) as ZoomLevel) : kept;
}
