import { useSyncExternalStore } from 'react';
import { diagramColors } from '../../../model/preview/diagram';
import type { DiagramColors } from '../../../model/repository.types';

const DARK = '(prefers-color-scheme: dark)';

/** Read once per theme: the tokens change only with it. */
const read = new Map<boolean, DiagramColors>();

function snapshot(): DiagramColors {
    const dark = window.matchMedia(DARK).matches;
    let colors = read.get(dark);
    if (!colors) {
        const style = getComputedStyle(document.documentElement);
        colors = diagramColors(dark, (token) => style.getPropertyValue(token));
        read.set(dark, colors);
    }
    return colors;
}

function subscribe(onChange: () => void): () => void {
    const query = window.matchMedia(DARK);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
}

/**
 * The app's colors for a diagram, from the page's `--ui-*` tokens in the theme on screen (which
 * the window's theme sets): a change of theme draws the diagrams again.
 */
export function useDiagramColors(): DiagramColors {
    return useSyncExternalStore(subscribe, snapshot);
}
