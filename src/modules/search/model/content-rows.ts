import type { Translator } from '@/shared/i18n';
import type { PaletteItem, PaletteRow } from './palette-items';
import type { ContentFile } from './search.types';

/**
 * The lines found in the files' contents, under their files: those of the file shown first, as
 * "In this file", then the others' in their order.
 */
export function contentRows(
    files: readonly ContentFile[],
    current: string | null,
    { t }: Translator,
): { items: PaletteItem[]; rows: PaletteRow[] } {
    const items: PaletteItem[] = [];
    const rows: PaletteRow[] = [];
    const addLines = (file: ContentFile) => {
        for (const line of file.lines) {
            const item: PaletteItem = {
                kind: 'line',
                path: file.path,
                number: line.number,
                label: line.text,
                highlights: line.highlights,
            };
            rows.push({ kind: 'item', item, index: items.length });
            items.push(item);
        }
    };
    const shown = files.find((file) => file.path === current);
    if (shown) {
        rows.push({ kind: 'group', label: t('palette.inThisFile') });
        addLines(shown);
    }
    const others = files.filter((file) => file !== shown);
    if (shown && others.length > 0) rows.push({ kind: 'group', label: t('palette.otherFiles') });
    for (const file of others) {
        rows.push({ kind: 'file', path: file.path, count: file.lines.length });
        addLines(file);
    }
    return { items, rows };
}
