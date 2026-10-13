/** Whether the target is a field, where keys type text. */
export function isField(target: EventTarget | null): target is HTMLElement {
    return (
        target instanceof HTMLElement &&
        (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
    );
}

/**
 * Whether a key belongs to what has the focus rather than to the app's shortcuts: a field, or a
 * dialog, a menu or a toast over the page, which handle their own keys (`Esc` included).
 */
export function isKeyTaken(target: EventTarget | null): boolean {
    return (
        isField(target) ||
        (target instanceof Element &&
            target.closest('[role="dialog"], [role="alertdialog"], [role="menu"]') !== null)
    );
}
