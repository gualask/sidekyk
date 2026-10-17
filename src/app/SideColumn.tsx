import {
    type CSSProperties,
    type PointerEvent,
    type ReactNode,
    type RefObject,
    useMemo,
    useRef,
    useState,
} from 'react';
import { FILES_TREE_WIDTH } from '@/modules/repository';
import type { PanelDefinition, PanelEdge } from '@/shared/panels/panel';
import { SidebarSplitter } from '@/shared/ui/SidebarSplitter';
import { useSidebarWidth } from '@/shared/ui/sidebar-width';
import { sideMinWidth, sideWidth, TILE_GAP } from './panels';

/** The least height a tile of the column keeps while the splitter between them is dragged. */
const TILE_MIN_HEIGHT = 96;
/** The split a double click goes back to. */
const EVEN_SPLIT = 0.5;

/**
 * The side column of a project's panels: Files above Notes, or the one not minimized (at least
 * one). It is as
 * wide as Files' tree (the setting both share), at least as wide as Notes needs; the splitter
 * before it drags that width, the one between its tiles their heights (`split`, the upper's share).
 */
export function SideColumn({
    panels,
    split,
    onSplit,
    tile,
}: {
    panels: readonly PanelDefinition[];
    split: number;
    onSplit: (split: number) => void;
    tile: (panel: PanelDefinition, size: CSSProperties, edge: PanelEdge | null) => ReactNode;
}) {
    const min = sideMinWidth(panels);
    const width = useSidebarWidth('files', { ...FILES_TREE_WIDTH, min });
    const [gap, setGap] = useState<HTMLElement | null>(null);
    const [box, setBox] = useState<HTMLElement | null>(null);
    const column = useMemo(() => ({ current: box }), [box]);
    const edge = gap && box ? { gap, box } : null;
    // the upper tile, whose share a drag changes before it is stored
    const upper = useRef<HTMLDivElement>(null);
    const [first, second] = panels;
    // Files puts the splitter of its tree there, which fits the tree on a double click; without
    // Files the column has a splitter of its own, which goes back to the least width
    const filesOnTop = first.id === 'files';

    return (
        <>
            <div
                ref={setGap}
                className="relative shrink-0"
                style={{ width: TILE_GAP, marginInline: -TILE_GAP }}
            >
                {filesOnTop ? null : (
                    <SidebarSplitter
                        width={width}
                        box={column}
                        place="gap"
                        fitting={() => min}
                        what="column"
                    />
                )}
            </div>
            <div
                ref={setBox}
                className="flex min-h-0 shrink-0 flex-col"
                style={sideWidth(width.style, min)}
            >
                {second ? (
                    <>
                        <div ref={upper} className="flex min-h-0" style={{ flex: `${split} 1 0` }}>
                            {tile(first, FILL, filesOnTop ? edge : null)}
                        </div>
                        <RowSplitter
                            upper={upper}
                            onSplit={onSplit}
                            onReset={() => onSplit(EVEN_SPLIT)}
                        />
                        <div className="flex min-h-0" style={{ flex: `${1 - split} 1 0` }}>
                            {tile(second, FILL, null)}
                        </div>
                    </>
                ) : (
                    <div className="flex min-h-0 flex-1">
                        {tile(first, FILL, filesOnTop ? edge : null)}
                    </div>
                )}
            </div>
        </>
    );
}

/** A tile of the column fills its slot. */
const FILL: CSSProperties = { flexGrow: 1, flexBasis: 0 };

/**
 * The splitter between the column's tiles: a drag moves the upper tile's edge (no render until the
 * button comes up, then the share is stored), a double click evens them.
 */
function RowSplitter({
    upper,
    onSplit,
    onReset,
}: {
    upper: RefObject<HTMLDivElement | null>;
    onSplit: (split: number) => void;
    onReset: () => void;
}) {
    const drag = (event: PointerEvent<HTMLDivElement>) => {
        const top = upper.current;
        const column = top?.parentElement;
        if (event.button !== 0 || !top || !column) return;
        event.preventDefault();
        const bar = event.currentTarget;
        bar.setPointerCapture(event.pointerId);
        const area = column.getBoundingClientRect();
        const room = area.height - bar.offsetHeight;
        const share = (y: number) => {
            const height = Math.min(
                Math.max(y - area.top - bar.offsetHeight / 2, TILE_MIN_HEIGHT),
                room - TILE_MIN_HEIGHT,
            );
            return room > 0 ? height / room : EVEN_SPLIT;
        };
        let last = share(event.clientY);
        const lower = bar.nextElementSibling as HTMLElement | null;
        const move = (moved: globalThis.PointerEvent) => {
            last = share(moved.clientY);
            top.style.flex = `${last} 1 0`;
            if (lower) lower.style.flex = `${1 - last} 1 0`;
        };
        const end = () => {
            bar.removeEventListener('pointermove', move);
            bar.removeEventListener('pointerup', end);
            bar.removeEventListener('pointercancel', end);
            delete bar.dataset.dragging;
            onSplit(Math.round(last * 1000) / 1000);
        };
        bar.dataset.dragging = '';
        bar.addEventListener('pointermove', move);
        bar.addEventListener('pointerup', end);
        bar.addEventListener('pointercancel', end);
    };

    return (
        <div
            aria-hidden
            title="Drag to resize; double click to even them"
            className="group relative z-[2] h-2 shrink-0 cursor-row-resize"
            onPointerDown={drag}
            onDoubleClick={onReset}
        >
            <span className="absolute inset-x-1/4 top-[3px] h-0.5 rounded-sm group-hover:bg-ui-accent group-data-dragging:bg-ui-accent" />
        </div>
    );
}
