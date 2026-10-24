export { type SearchPort, SearchProvider } from './application/search.port';
export type { PaletteBook } from './model/palette-rows';
export type {
    ContentEnd,
    ContentFile,
    Highlight,
    SearchRequest,
    SearchResults,
} from './model/search.types';
export type { PaletteActions, PaletteMode } from './ui/CommandPalette';

/** The command palette, loaded once the window is idle after the first paint, or on first use. */
export const loadCommandPalette = () => import('./ui/CommandPalette');
