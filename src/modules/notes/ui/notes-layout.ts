import type { NoteLines } from '@/shared/notes/note-lines';

/** Grows a text field with what it holds, up to its CSS max height. */
export function autosize(field: HTMLTextAreaElement | null) {
    if (!field) return;
    field.style.height = 'auto';
    field.style.height = `${field.scrollHeight}px`;
}

/**
 * What a list row adds to its name, in pixels, as `NoteLists` lays it out: the row's left padding
 * (`pl-3`), the gap and the count's room (`gap-2`, two digits and the trash in their place), its
 * right padding (`pr-2`) and the lists' own (`p-1.5`).
 */
const LIST_ROW_EXTRA = 12 + 8 + 28 + 12;

/** What the lists need to show every name whole, from their font's width. */
export function fittingListsWidth(names: readonly string[], box: HTMLElement): number {
    const style = getComputedStyle(box);
    const context = document.createElement('canvas').getContext('2d');
    if (!context) return 0;
    context.font = `600 13px ${style.fontFamily}`;
    const widest = Math.max(0, ...names.map((name) => context.measureText(name).width));
    return Math.ceil(widest + LIST_ROW_EXTRA);
}

/** How a note's text field lays out long lines: wrapped, or on one line with a sideways scroll. */
export function linesClass(lines: NoteLines): string {
    return lines === 'wrap'
        ? 'break-words whitespace-pre-wrap'
        : 'overflow-x-auto [overflow-wrap:normal] whitespace-pre';
}
