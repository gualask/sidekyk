import type { MessageKey } from '@/shared/i18n';

/** What the palette looks for, in the order of its tabs: places by name, or a text in the files. */
export const PALETTE_MODE_ORDER = ['names', 'contents'] as const;

export type PaletteMode = (typeof PALETTE_MODE_ORDER)[number];

/** Each mode's name, and the letter that opens it with `⌘` (`Ctrl`), as `shortcutKey` names it. */
export const PALETTE_MODES: Record<PaletteMode, { label: MessageKey; key: string }> = {
    names: { label: 'common.goTo', key: 'k' },
    contents: { label: 'common.findInFiles', key: 'f' },
};

/** The mode a letter with `⌘` (`Ctrl`) opens, if any. */
export function paletteModeForKey(key: string): PaletteMode | undefined {
    return PALETTE_MODE_ORDER.find((mode) => PALETTE_MODES[mode].key === key);
}
