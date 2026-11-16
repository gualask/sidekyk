export { type SearchPort, SearchProvider } from './application/search.port';
export { useFileSearch, useNameRanking } from './application/search.queries';
export type { PaletteBook } from './model/palette-items';
export { type PaletteMode, paletteModeForKey } from './model/palette-modes';
export type {
    ContentEnd,
    ContentFile,
    FileMatches,
    SearchRequest,
    SearchResults,
} from './model/search.types';
export type { PaletteActions } from './ui/CommandPalette';

/** The command palette, loaded once the window is idle after the first paint, or on first use. */
export const loadCommandPalette = () => import('./ui/CommandPalette');
