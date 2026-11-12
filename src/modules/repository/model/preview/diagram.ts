import type { DiagramColors } from '../repository.types';
import tokens from './diagram-tokens.json';

/** The colors a diagram takes one token each for. */
type SingleColors = Omit<DiagramColors, 'dark' | 'series'>;

/**
 * The `--ui-*` token each of a diagram's colors takes (`diagram-tokens.json`, which the backend's
 * fixture test reads too): the preview's background, nodes as the code blocks' surface, notes as
 * a warning, the series in turn. Typed, so a color the file misses does not compile.
 */
const DIAGRAM_TOKENS: Record<keyof SingleColors, string> & { series: string[] } = tokens;

/** A diagram's colors, from a token's value as the page has it in this theme. */
export function diagramColors(dark: boolean, value: (token: string) => string): DiagramColors {
    const { series, ...single } = DIAGRAM_TOKENS;
    const colors = Object.fromEntries(
        Object.entries(single).map(([name, token]) => [name, value(token).trim()]),
    ) as SingleColors;
    return { ...colors, dark, series: series.map((token) => value(token).trim()) };
}

/** An image's URL for a drawn diagram's SVG: it loads nothing and runs nothing as an image. */
export function diagramUrl(svg: string): string {
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** How far a diagram may be zoomed out and in. */
export const ZOOM = { min: 0.1, max: 8, step: 1.25 };

/** A diagram's place in its view: shifted by `x`, `y` (CSS pixels), scaled by `scale`. */
export interface Placement {
    x: number;
    y: number;
    scale: number;
}

/** The space left around a diagram fitted to its view. */
const FIT_MARGIN = 24;

/**
 * A diagram of `width` × `height` fitted to a view and centered in it: never larger than its own
 * size, smaller only to fit.
 */
export function fitted(
    diagram: { width: number; height: number },
    view: { width: number; height: number },
): Placement {
    const room = (size: number) => Math.max(size - 2 * FIT_MARGIN, 1);
    const scale = Math.min(1, room(view.width) / diagram.width, room(view.height) / diagram.height);
    return {
        scale,
        x: (view.width - diagram.width * scale) / 2,
        y: (view.height - diagram.height * scale) / 2,
    };
}

/** The placement zoomed by `factor` around a point of the view, which stays where it is. */
export function zoomedAt(
    placement: Placement,
    factor: number,
    at: { x: number; y: number },
): Placement {
    const scale = Math.min(ZOOM.max, Math.max(ZOOM.min, placement.scale * factor));
    const ratio = scale / placement.scale;
    return {
        scale,
        x: at.x - (at.x - placement.x) * ratio,
        y: at.y - (at.y - placement.y) * ratio,
    };
}
