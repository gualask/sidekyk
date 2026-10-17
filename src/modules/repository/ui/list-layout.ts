import { splitPath } from '../model/file-groups';
import type { FileChange } from '../model/repository.types';

/**
 * What a list needs to show every file row whole: its name, folder and line counts. The room
 * besides the texts and their fonts are read from a row on screen (`FileRow` marks its parts), the
 * texts of every file measured on a canvas, one pass per font. Line counts show in the mono font,
 * a space for the room between them; a list with no row on screen has nothing to fit.
 */
export function fittingRowsWidth(files: readonly FileChange[], list: HTMLElement): number {
    const part = (name: string) => list.querySelector<HTMLElement>(`[data-file-${name}]`);
    const [text, name, dir, counts] = ['text', 'name', 'dir', 'counts'].map(part);
    const context = document.createElement('canvas').getContext('2d');
    if (!text || !name || !dir || !counts || !context) return 0;
    const width = (element: Element) => element.getBoundingClientRect().width;
    const font = (element: Element, family?: string) => {
        const style = getComputedStyle(element);
        return `${style.fontWeight} ${style.fontSize} ${family ?? style.fontFamily}`;
    };
    // padding, badge, gaps and the list's border: all but the texts
    const chrome = width(list) - width(text) - width(counts);
    const widths = files.map(() => chrome);
    const pass = (shown: string, of: (file: FileChange) => string | null, gap = 0) => {
        context.font = shown;
        files.forEach((file, index) => {
            const value = of(file);
            if (value) widths[index] += context.measureText(value).width + gap;
        });
    };
    const counted = (file: FileChange) =>
        !file.binary && (file.additions !== null || file.deletions !== null);
    pass(font(name), (file) => splitPath(file.path).name);
    pass(
        font(dir),
        (file) => splitPath(file.path).dir || null,
        Number.parseFloat(getComputedStyle(dir).marginLeft),
    );
    pass(font(counts), (file) => (file.binary ? 'binary' : counted(file) ? null : '—'));
    pass(font(counts, getComputedStyle(list).getPropertyValue('--font-mono')), (file) =>
        counted(file) ? `+${file.additions ?? 0} −${file.deletions ?? 0}` : null,
    );
    return Math.ceil(widths.reduce((widest, rowWidth) => Math.max(widest, rowWidth), 0));
}
