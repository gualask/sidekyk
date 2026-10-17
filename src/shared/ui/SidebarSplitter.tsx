import type { RefObject } from 'react';
import type { SidebarWidth } from './sidebar-width';

/**
 * The splitter of a sidebar: a drag resizes the sidebar, a double click fits what it shows and a
 * second one goes back. Eight pixels wide over the sidebar's right edge (`edge`), or filling the
 * gap the app gives a tile that is the sidebar, by the tile on its left (`gap`, `PanelProps.edge`).
 */
export function SidebarSplitter({
    width,
    box,
    place,
    fitting,
    what,
}: {
    width: SidebarWidth;
    /** The sidebar, whose width the splitter sets. */
    box: RefObject<HTMLElement | null>;
    place: 'edge' | 'gap';
    /** The width that shows all the sidebar has, measured on the double click. */
    fitting: (box: HTMLElement) => number;
    /** What the sidebar shows, for the tooltip: "tree", "list". */
    what: string;
}) {
    return (
        <div
            aria-hidden
            title={`Drag to resize; double click to fit the whole ${what}, again to go back`}
            className={`group z-[2] cursor-col-resize ${
                place === 'edge' ? 'relative -ml-1 w-2 shrink-0' : 'absolute inset-0'
            }`}
            onPointerDown={(event) => {
                if (box.current)
                    width.drag(event, box.current, place === 'edge' ? 'right' : 'left');
            }}
            onDoubleClick={() => {
                if (box.current) width.fit(fitting(box.current), box.current);
            }}
        >
            <span className="absolute inset-y-1/4 left-[3px] w-0.5 rounded-sm group-hover:bg-ui-accent" />
        </div>
    );
}
