import type { ChangedFile, ChangeKind, Directory } from './repository.types';

/**
 * The Files panel's tree as one flat list, so only the rows on screen are rendered: the entries of
 * the open folders, each under its folder. `more` stands for the entries a large folder does not
 * list.
 */
export type TreeRow =
    | { kind: 'folder'; name: string; path: string; depth: number; open: boolean }
    | { kind: 'file'; name: string; path: string; depth: number }
    | { kind: 'more'; count: number; depth: number; path: string };

/** What a folder holds, once read. */
export type ReadDirectory = (path: string) => Directory | undefined;

/** The root, then every open folder in an open folder, as far as the tree is read. */
export function foldersToRead(open: ReadonlySet<string>, read: ReadDirectory): string[] {
    const folders: string[] = [];
    const walk = (path: string) => {
        folders.push(path);
        for (const entry of read(path)?.entries ?? []) {
            if (entry.folder && open.has(entry.path)) walk(entry.path);
        }
    };
    walk('');
    return folders;
}

export function treeRows(open: ReadonlySet<string>, read: ReadDirectory): TreeRow[] {
    const rows: TreeRow[] = [];
    const walk = (path: string, depth: number) => {
        const directory = read(path);
        if (!directory) return;
        for (const { name, path: entryPath, folder } of directory.entries) {
            if (!folder) {
                rows.push({ kind: 'file', name, path: entryPath, depth });
                continue;
            }
            const isOpen = open.has(entryPath);
            rows.push({ kind: 'folder', name, path: entryPath, depth, open: isOpen });
            if (isOpen) walk(entryPath, depth + 1);
        }
        if (directory.more > 0) {
            rows.push({ kind: 'more', count: directory.more, depth, path: `${path}/…` });
        }
    };
    walk('', 0);
    return rows;
}

/** The folders above a path, outermost first. */
export function foldersAbove(path: string): string[] {
    const parts = path.split('/');
    return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join('/'));
}

/** How a change colors a name in the tree, as VS Code's explorer: amber, or green for new. */
export type ChangeMark = 'modified' | 'added';

const NEW_KINDS: ReadonlySet<ChangeKind> = new Set(['untracked', 'added', 'renamed', 'copied']);

/**
 * The mark of every changed file, and of every folder above one: a folder takes the strongest
 * change inside it, an edit over a new file. A deleted file is not in the tree, and marks
 * nothing.
 */
export function changeMarks(files: readonly ChangedFile[]): ReadonlyMap<string, ChangeMark> {
    const marks = new Map<string, ChangeMark>();
    const mark = (path: string, next: ChangeMark) => {
        if (marks.get(path) !== 'modified') marks.set(path, next);
    };
    for (const file of files) {
        if (file.kind === 'deleted') continue;
        const next = NEW_KINDS.has(file.kind) ? 'added' : 'modified';
        mark(file.path, next);
        for (const folder of foldersAbove(file.path)) mark(folder, next);
    }
    return marks;
}

/** What a key does in the tree. */
export type TreeMove =
    | { kind: 'select'; path: string; folder: boolean }
    | { kind: 'toggle'; path: string }
    | { kind: 'open'; path: string };

/** The rows a selection can be on: every row but the count of what a folder does not list. */
function selectable(row: TreeRow | undefined): row is Exclude<TreeRow, { kind: 'more' }> {
    return row !== undefined && row.kind !== 'more';
}

/**
 * As in VS Code: `↓`/`↑` (`j`/`k`) move, `→` opens a folder or goes into it, `←` closes it or goes
 * up to the folder above, `↵` and `Space` open a file or open and close a folder. Nothing for any
 * other key, or where the selection cannot go.
 */
export function treeMove(
    rows: readonly TreeRow[],
    selected: string | null,
    key: string,
): TreeMove | null {
    const at = rows.findIndex((row) => row.kind !== 'more' && row.path === selected);
    const row = rows[at];
    const select = (index: number, step: number): TreeMove | null => {
        for (let i = index; i >= 0 && i < rows.length; i += step) {
            const candidate = rows[i];
            if (selectable(candidate)) {
                return {
                    kind: 'select',
                    path: candidate.path,
                    folder: candidate.kind === 'folder',
                };
            }
        }
        return null;
    };
    if (key === 'ArrowDown' || key === 'j') return select(at < 0 ? 0 : at + 1, 1);
    if (key === 'ArrowUp' || key === 'k') return select(at < 0 ? 0 : at - 1, at < 0 ? 1 : -1);
    if (!selectable(row)) return null;
    if (key === 'ArrowRight') {
        if (row.kind !== 'folder') return null;
        return row.open ? select(at + 1, 1) : { kind: 'toggle', path: row.path };
    }
    if (key === 'ArrowLeft') {
        if (row.kind === 'folder' && row.open) return { kind: 'toggle', path: row.path };
        const above = rows.slice(0, at).findLastIndex((other) => other.depth < row.depth);
        return above < 0 ? null : select(above, -1);
    }
    if (key === 'Enter' || key === ' ') {
        return row.kind === 'folder'
            ? { kind: 'toggle', path: row.path }
            : { kind: 'open', path: row.path };
    }
    return null;
}
