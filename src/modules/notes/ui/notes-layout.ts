/** Grows a text field with what it holds, up to its CSS max height. */
export function autosize(field: HTMLTextAreaElement | null) {
    if (!field) return;
    field.style.height = 'auto';
    field.style.height = `${field.scrollHeight}px`;
}

/** A list row's padding and the room its count takes, in pixels: what a fit adds to a name. */
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
