import {
    type CSSProperties,
    Fragment,
    type ReactNode,
    type RefObject,
    useMemo,
    useRef,
    useState,
} from 'react';
import { DEFAULT_TILES_LAYOUT } from '@/modules/projects';
import { useTranslation } from '@/shared/i18n';
import type { PanelDefinition, PanelProps } from '@/shared/panels/panel';
import { trackDrag } from '@/shared/ui/pointer-drag';
import { SidebarSplitter } from '@/shared/ui/SidebarSplitter';
import { useSidebarWidth } from '@/shared/ui/sidebar-width';
import { MAIN_TILE, SIDE_WIDTH, sideMinWidth, TILE_BORDERS, TILE_GAP } from './panels';

/** The least height a tile of the column keeps while the splitter between them is dragged. */
const TILE_MIN_HEIGHT = 96;

/**
 * The side column of a project's panels, top to bottom, those not minimized (at least one). Its
 * width is one setting (`SIDE_WIDTH`), at least the widest least width of its tiles; the splitter
 * before it drags it, a double click fits what its tiles need (as their panels tell, `tileFit`)
 * or, when none tells, goes back to the default. The splitter between two tiles shares their
 * height (`split`, the upper's share). Each tile keeps its place in the tree, so minimizing one
 * never mounts the other again.
 */
export function SideColumn({
    panels,
    shown,
    split,
    onSplit,
    tile,
}: {
    /** Every panel of the column, in its order. */
    panels: readonly PanelDefinition[];
    /** Those not minimized. */
    shown: readonly PanelDefinition[];
    split: number;
    onSplit: (split: number) => void;
    tile: (panel: PanelDefinition, tileFit: PanelProps['tileFit']) => ReactNode;
}) {
    const min = sideMinWidth(shown);
    const width = useSidebarWidth(SIDE_WIDTH.sidebar, { initial: SIDE_WIDTH.initial, min });
    const [box, setBox] = useState<HTMLElement | null>(null);
    const column = useMemo(() => ({ current: box }), [box]);

    // what each tile needs, as its panel measures it
    const fits = useRef(new Map<string, () => number>());
    const tileFits = useMemo(
        () =>
            new Map(
                panels.map((panel) => [
                    panel.id,
                    (measure: (() => number) | null) => {
                        if (measure) fits.current.set(panel.id, measure);
                        else fits.current.delete(panel.id);
                    },
                ]),
            ),
        [panels],
    );
    const fitting = () => {
        const needs = shown.flatMap((panel) => fits.current.get(panel.id)?.() ?? []);
        return needs.length > 0 ? Math.max(...needs) + TILE_BORDERS : null;
    };

    const two = shown.length > 1;
    const upper = useRef<HTMLDivElement>(null);
    const lower = useRef<HTMLDivElement>(null);

    return (
        <>
            <div className="relative shrink-0" style={{ width: TILE_GAP, marginInline: -TILE_GAP }}>
                <SidebarSplitter
                    width={width}
                    box={column}
                    place="gap"
                    fitting={fitting}
                    what="column"
                />
            </div>
            <div
                ref={setBox}
                className="flex min-h-0 shrink-0 flex-col"
                style={columnWidth(width.style, min)}
            >
                {panels.map((panel) => {
                    if (!shown.includes(panel)) return null;
                    const first = panel === shown[0];
                    return (
                        <Fragment key={panel.id}>
                            {two && !first ? (
                                <RowSplitter
                                    upper={upper}
                                    lower={lower}
                                    onSplit={onSplit}
                                    onReset={() => onSplit(DEFAULT_TILES_LAYOUT.split)}
                                />
                            ) : null}
                            <div
                                ref={!two ? null : first ? upper : lower}
                                className="flex min-h-0"
                                style={{ flex: `${!two ? 1 : first ? split : 1 - split} 1 0` }}
                            >
                                {tile(panel, tileFits.get(panel.id) ?? null)}
                            </div>
                        </Fragment>
                    );
                })}
            </div>
        </>
    );
}

/** The column's width: its own, at least `min`, bounded by what Changes keeps. */
function columnWidth(width: CSSProperties, min: number): CSSProperties {
    return {
        ...width,
        minWidth: min,
        maxWidth: `max(${min}px, 100% - ${MAIN_TILE.minWidth + TILE_GAP}px)`,
    };
}

/**
 * The splitter between the column's tiles: a drag moves their edge (no render until the button
 * comes up, then the share is stored), a double click evens them.
 */
function RowSplitter({
    upper,
    lower,
    onSplit,
    onReset,
}: {
    upper: RefObject<HTMLDivElement | null>;
    lower: RefObject<HTMLDivElement | null>;
    onSplit: (split: number) => void;
    onReset: () => void;
}) {
    const { t } = useTranslation();
    return (
        <div
            aria-hidden
            title={t('splitter.even')}
            className="group relative z-[2] h-2 shrink-0 cursor-row-resize"
            onPointerDown={(event) => {
                const top = upper.current;
                const bottom = lower.current;
                const column = top?.parentElement;
                if (event.button !== 0 || !top || !bottom || !column) return;
                const bar = event.currentTarget;
                const area = column.getBoundingClientRect();
                const room = area.height - bar.offsetHeight;
                const shareAt = (y: number) => {
                    const height = Math.min(
                        Math.max(y - area.top - bar.offsetHeight / 2, TILE_MIN_HEIGHT),
                        room - TILE_MIN_HEIGHT,
                    );
                    return room > 0 ? height / room : DEFAULT_TILES_LAYOUT.split;
                };
                let last = shareAt(event.clientY);
                bar.dataset.dragging = '';
                trackDrag(
                    event,
                    (pointer) => {
                        last = shareAt(pointer.clientY);
                        top.style.flex = `${last} 1 0`;
                        bottom.style.flex = `${1 - last} 1 0`;
                    },
                    (moved) => {
                        delete bar.dataset.dragging;
                        if (moved) onSplit(Math.round(last * 1000) / 1000);
                    },
                );
            }}
            onDoubleClick={onReset}
        >
            <span className="absolute inset-x-1/4 top-[3px] h-0.5 rounded-sm group-hover:bg-ui-accent group-data-dragging:bg-ui-accent" />
        </div>
    );
}
