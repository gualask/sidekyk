const AVATAR_COLORS = 6;

/**
 * The avatar color of a project, `--ui-avatar-1` to `--ui-avatar-6`. It comes from the root, not
 * the position in the list, so a project keeps its color when another one is added or removed.
 */
export function avatarColor(root: string): string {
    let hash = 0;
    for (const char of root) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
    return `var(--ui-avatar-${(hash % AVATAR_COLORS) + 1})`;
}

/** The avatar's letter: the name's first one, as the user sees it. */
export function avatarLetter(name: string): string {
    return (Array.from(name)[0] ?? '?').toLocaleUpperCase();
}
