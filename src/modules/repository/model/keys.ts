/**
 * What a key does in the module's lists (Changes' files, the tree, Recent), as in VS Code with
 * Vim's `j`/`k`: `↓`/`j` the next row, `↑`/`k` the previous one, `↵` and `Space` open it.
 */
export type ListMove = 'next' | 'previous' | 'open';

const LIST_MOVES: Readonly<Record<string, ListMove>> = {
    ArrowDown: 'next',
    j: 'next',
    ArrowUp: 'previous',
    k: 'previous',
    Enter: 'open',
    ' ': 'open',
};

/** The move a key asks of a list; null for any other key. */
export function listMove(key: string): ListMove | null {
    return Object.hasOwn(LIST_MOVES, key) ? (LIST_MOVES[key] ?? null) : null;
}

/** The keys a list in a tile leaves to the workspace: the arrows move among tiles, `↵` zooms. */
export function leftToTiles(key: string): boolean {
    return key.startsWith('Arrow') || key === 'Enter';
}

/** The change `n` (the next) or `p` (the previous) steps to; 0 for any other key. */
export function changeStep(key: string): 1 | -1 | 0 {
    if (key === 'n') return 1;
    return key === 'p' ? -1 : 0;
}
