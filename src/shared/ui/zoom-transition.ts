import { flushSync } from 'react-dom';

/**
 * The elements a zoom carries from one level to the next, as `view-transition-name`s: the
 * project (its card at all projects, its panels below), and each panel (its tile, or full
 * screen). One element at a time has each name.
 */
export const ZOOM_NAMES = {
    project: 'zoom-project',
    panel: (id: string) => `zoom-panel-${id}`,
};

/**
 * The control that zooms in on what is under the pointer: an element marked `data-zoom` (a card,
 * a tile) holds one marked `data-zoom-in` (the card's name, the tile's zoom button). `⌘`+scroll
 * presses it, so the zoom takes the same path as a click.
 */
export function zoomControlAt(target: EventTarget | null): HTMLElement | null {
    if (!(target instanceof Element)) return null;
    return target.closest('[data-zoom]')?.querySelector<HTMLElement>('[data-zoom-in]') ?? null;
}

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

/**
 * Changes the zoom level inside a view transition, so the project or panel grows from where it
 * was. The update renders at once (`flushSync`) for the transition to capture it. Without the
 * API (older WebKitGTK) or with reduced motion, the level just changes.
 */
export function zoomTransition(update: () => void): void {
    if (!document.startViewTransition || reducedMotion.matches) {
        update();
        return;
    }
    document.startViewTransition(() => flushSync(update));
}
