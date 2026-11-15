import type { Translator } from '@/shared/i18n';
import { splitPath } from '@/shared/projects/file-path';
import { fittedWidth } from '@/shared/ui/sidebar-width';
import { countsText } from '../../../model/line-counts';
import type { FileChange } from '../../../model/repository.types';

/**
 * The width that shows every file row of a list whole: its name, folder and line counts. The room
 * besides the texts and their fonts are read from a row on screen (`FileRow` marks its parts), the
 * texts of every file measured on a canvas, one pass per font. The counts are measured as
 * `LineCounts` writes them (`countsText`): lines in the mono font, a space for the room between
 * them; a list with no row on screen has nothing to fit.
 */
export function fittingRowsWidth(
    files: readonly FileChange[],
    list: HTMLElement,
    i18n: Translator,
): number {
    const part = (name: string) => list.querySelector<HTMLElement>(`[data-file-${name}]`);
    const [text, name, dir, counts] = ['text', 'name', 'dir', 'counts'].map(part);
    const context = document.createElement('canvas').getContext('2d');
    if (!text || !name || !dir || !counts || !context) return 0;
    const width = (element: Element) => element.getBoundingClientRect().width;
    const font = (element: Element, family?: string) => {
        const style = getComputedStyle(element);
        return `${style.fontWeight} ${style.fontSize} ${family ?? style.fontFamily}`;
    };
    const row = text.closest('button');
    if (!row) return 0;
    // a row's padding, badge and gaps: all but its texts
    const chrome = width(row) - width(text) - width(counts);
    const widths = files.map(() => chrome);
    const pass = (
        shown: string,
        of: (file: FileChange, index: number) => string | null,
        gap = 0,
    ) => {
        context.font = shown;
        files.forEach((file, index) => {
            const value = of(file, index);
            if (value) widths[index] += context.measureText(value).width + gap;
        });
    };
    const countsOf = files.map((file) => countsText(file, i18n));
    pass(font(name), (file) => splitPath(file.path).name);
    pass(
        font(dir),
        (file) => splitPath(file.path).dir || null,
        Number.parseFloat(getComputedStyle(dir).marginLeft),
    );
    pass(font(counts), (_, index) => {
        const shown = countsOf[index];
        return shown && shown.kind !== 'lines' ? shown.text : null;
    });
    pass(font(counts, getComputedStyle(list).getPropertyValue('--font-mono')), (_, index) => {
        const shown = countsOf[index];
        return shown?.kind === 'lines' ? `${shown.added} ${shown.removed}` : null;
    });
    return fittedWidth(
        list,
        width(row),
        widths.reduce((widest, rowWidth) => Math.max(widest, rowWidth), 0),
    );
}
