import {
    type CSSProperties,
    createContext,
    createElement,
    type PointerEvent,
    type ReactNode,
    useContext,
    useRef,
    useState,
} from 'react';
import { trackDrag } from './pointer-drag';

/** The sidebars' widths as last dragged, by sidebar, and how to store one; the app keeps them. */
export interface SidebarWidths {
    widths: Readonly<Record<string, number>>;
    /** Stores a sidebar's width; null goes back to its default. */
    store: (sidebar: string, width: number | null) => void;
}

/** What a sidebar leaves the content beside it, at least: it never takes that room. */
const CONTENT_MIN_WIDTH = 240;

const SidebarWidthsContext = createContext<SidebarWidths | null>(null);

export function SidebarWidthsProvider({
    value,
    children,
}: {
    value: SidebarWidths;
    children: ReactNode;
}) {
    return createElement(SidebarWidthsContext.Provider, { value }, children);
}

/** A sidebar's width, as `useSidebarWidth` gives it. */
export interface SidebarWidth {
    /** The sidebar's width, leaving the content beside it its room. */
    style: CSSProperties;
    /** Drags the sidebar's edge: the right one, or the left one of a sidebar on the right. */
    drag: (event: PointerEvent<HTMLElement>, box: HTMLElement, side: 'left' | 'right') => void;
    /** Fits the sidebar to what it shows, at the width given; a second fit goes back. */
    fit: (fitting: number, box: HTMLElement) => void;
    /** Back to its default width. */
    reset: () => void;
}

/**
 * A sidebar's width: the one stored once dragged, else its default. A drag moves the sidebar's
 * edge itself, with no render, and stores the width shown when the button comes up; a double click
 * fits what it shows, a second one goes back. The layout bounds the width (the content beside
 * keeps its room): what is stored is what it allowed.
 */
export function useSidebarWidth(
    sidebar: string,
    { initial, min }: { initial: number; min: number },
): SidebarWidth {
    const context = useContext(SidebarWidthsContext);
    if (!context) {
        throw new Error('useSidebarWidth must be used within SidebarWidthsProvider');
    }
    const stored = context.widths[sidebar] ?? null;
    const store = (width: number | null) => {
        if (width !== stored) context.store(sidebar, width);
    };
    // the width a drag ended on, shown until the stored one changes from the one it was dragged over
    const [dragged, setDragged] = useState<{ width: number; over: number | null } | null>(null);
    // the width before a fit, for the next double click to go back to
    const beforeFit = useRef<number | null | undefined>(undefined);
    const value = dragged?.over === stored ? dragged.width : (stored ?? initial);

    const resize = (box: HTMLElement, width: number) => {
        box.style.width = `${Math.round(Math.max(min, width))}px`;
    };
    /** The width the layout lets the sidebar have. */
    const shown = (box: HTMLElement) => Math.round(box.getBoundingClientRect().width);

    return {
        style: { width: value, maxWidth: `calc(100% - ${CONTENT_MIN_WIDTH}px)` },
        drag: (event, box, side) => {
            const from = event.clientX;
            const start = shown(box);
            const sign = side === 'right' ? 1 : -1;
            // a click is no drag: the clicks of a double click leave the width before a fit alone
            trackDrag(
                event,
                (pointer) => resize(box, start + sign * (pointer.clientX - from)),
                (moved) => {
                    if (!moved) return;
                    const last = shown(box);
                    resize(box, last);
                    beforeFit.current = undefined;
                    setDragged({ width: last, over: stored });
                    store(last);
                },
            );
        },
        fit: (fitting, box) => {
            if (beforeFit.current !== undefined) {
                store(beforeFit.current);
                beforeFit.current = undefined;
                return;
            }
            const [current, before] = [shown(box), box.style.width];
            resize(box, fitting);
            const target = shown(box);
            box.style.width = before;
            if (target <= current + 1) return;
            beforeFit.current = stored;
            store(target);
        },
        reset: () => {
            beforeFit.current = undefined;
            setDragged(null);
            store(null);
        },
    };
}
