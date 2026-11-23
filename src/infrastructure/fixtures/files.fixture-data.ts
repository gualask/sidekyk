import type {
    ChangedFile,
    Directory,
    FileContent,
    RecentFiles,
    TreeEntry,
} from '@/modules/repository';
import { splitPath } from '@/shared/projects/file-path';
import { FILE_TEXTS, VAULT_PATHS } from './fixture-files';

/** The files git lists in the review scenario's repository, besides the changed ones. */
const REVIEW_PATHS = [
    '.github/workflows/ci.yml',
    '.gitignore',
    'README.md',
    'LICENSE',
    'package.json',
    'tsconfig.json',
    'db/migrations/001_init.sql',
    'db/migrations/002_carts.sql',
    'db/migrations/010_coupons.sql',
    'docs/architecture/overview.md',
    'docs/architecture/payments.md',
    'docs/latest.md',
    'public/favicon.ico',
    'src/main.ts',
    'src/app.tsx',
    'src/cart/cart.ts',
    'src/cart/index.ts',
    'src/components/ui/button/Button.tsx',
    'src/components/ui/button/Button.test.tsx',
    'src/legacy/old-cart.ts',
    'src/utils/dates.ts',
    'vendor/payments-sdk',
];

/**
 * What the review scenario's `.gitignore` hides, each at the top of what it hides, as git lists
 * them; and the files under them, read from disk when their folder is opened.
 */
const IGNORED_ENTRIES = ['node_modules', 'dist', 'debug.log'];
const IGNORED_FILES = [
    'debug.log',
    'dist/assets/index-4f2a.js',
    'dist/assets/index-9c1e.css',
    'dist/index.html',
    'node_modules/.vite/deps/react.js',
    'node_modules/react/index.js',
    'node_modules/react/package.json',
    'node_modules/zod/index.js',
    'node_modules/zod/package.json',
];

/** In the large scenario: enough files that the tree is virtualized, and a folder too large to list. */
function largePaths(): string[] {
    const paths: string[] = [];
    for (let i = 0; i < 50_000; i++) {
        paths.push(
            `generated/module-${String(i % 50).padStart(2, '0')}/file-${String(i).padStart(4, '0')}.ts`,
        );
    }
    for (let i = 0; i < 10_050; i++) paths.push(`snapshots/case-${i}.json`);
    paths.push('generated/big.ts', 'README.md');
    return paths;
}

/**
 * The folder entries a list of paths makes, as
 * `src-tauri/crates/core/src/modules/folder/tree/`.
 */
class FixtureTree {
    private readonly folders = new Map<string, { folders: Set<string>; files: string[] }>();
    /** Every file's path, sorted: the palette searches them. */
    readonly files: readonly string[];

    constructor(
        paths: Iterable<string>,
        private readonly ignored: readonly string[] = [],
        private readonly ignoredFiles: readonly string[] = [],
    ) {
        // UTF-16 order: the backend's byte order, but past U+FFFF
        this.files = [...new Set(paths)].sort((a, b) => (a < b ? -1 : Number(a > b)));
        this.folder('');
        for (const path of this.files) {
            const parts = path.split('/');
            for (let i = 0; i < parts.length - 1; i++) {
                this.folder(parts.slice(0, i).join('/')).folders.add(parts[i] ?? '');
                this.folder(parts.slice(0, i + 1).join('/'));
            }
            this.folder(parts.slice(0, -1).join('/')).files.push(parts.at(-1) ?? '');
        }
    }

    private folder(path: string) {
        let folder = this.folders.get(path);
        if (!folder) {
            folder = { folders: new Set(), files: [] };
            this.folders.set(path, folder);
        }
        return folder;
    }

    /** Whether `path` is an ignored entry or inside an ignored folder. */
    private isIgnored(path: string): boolean {
        return this.ignored.some((entry) => path === entry || path.startsWith(`${entry}/`));
    }

    /** The ignored entries right in the folder at `path`, as git lists them. */
    private ignoredIn(path: string): string[] {
        return this.ignored.filter((entry) => splitPath(entry).dir === path);
    }

    /** What an ignored folder holds, as read from disk: all ignored, no folders sharing a row. */
    private ignoredDirectory(path: string): Directory {
        const folders = new Set<string>();
        const files = new Set<string>();
        for (const file of this.ignoredFiles) {
            if (!file.startsWith(`${path}/`)) continue;
            const [name = '', ...rest] = file.slice(path.length + 1).split('/');
            (rest.length > 0 ? folders : files).add(name);
        }
        const entry = (folder: boolean) => (name: string) => ({
            name,
            path: `${path}/${name}`,
            folder,
            ignored: true,
        });
        return {
            entries: [
                ...[...folders].sort(byName).map(entry(true)),
                ...[...files].sort(byName).map(entry(false)),
            ],
            more: 0,
            truncated: false,
        };
    }

    directory(path: string): Directory {
        const folder = this.folders.get(path);
        if (!folder) {
            return this.isIgnored(path)
                ? this.ignoredDirectory(path)
                : { entries: [], more: 0, truncated: false };
        }
        const child = (name: string) => (path ? `${path}/${name}` : name);
        const ignored = this.ignoredNames(path);
        const folders = [...folder.folders, ...ignored.folders]
            .sort(byName)
            .map(
                (name): TreeEntry =>
                    ignored.folders.includes(name)
                        ? { name, path: child(name), folder: true, ignored: true }
                        : this.folderEntry(name, child(name)),
            );
        const files = [...new Set(folder.files), ...ignored.files].sort(byName).map(
            (name): TreeEntry => ({
                name,
                path: child(name),
                folder: false,
                ignored: ignored.files.includes(name),
            }),
        );
        const entries = [...folders, ...files];
        return {
            entries: entries.slice(0, MAX_ENTRIES),
            more: Math.max(0, entries.length - MAX_ENTRIES),
            truncated: false,
        };
    }

    /** The names of the ignored folders and files right in the folder at `path`. */
    private ignoredNames(path: string): { folders: string[]; files: string[] } {
        const names = this.ignoredIn(path);
        const isFolder = (entry: string) =>
            this.ignoredFiles.some((file) => file.startsWith(`${entry}/`));
        const name = (entry: string) => splitPath(entry).name;
        return {
            folders: names.filter(isFolder).map(name),
            files: names.filter((entry) => !isFolder(entry)).map(name),
        };
    }

    /**
     * The entry of the folder `name` at `path`, shared with the folders down to one that holds
     * files, ignored entries or several folders.
     */
    private folderEntry(name: string, path: string): TreeEntry {
        let label = name;
        let at = path;
        for (;;) {
            const inside = this.folders.get(at);
            const only =
                inside && inside.files.length === 0 && this.ignoredIn(at).length === 0
                    ? [...inside.folders]
                    : [];
            if (only.length !== 1 || !only[0]) break;
            label = `${label}/${only[0]}`;
            at = `${at}/${only[0]}`;
        }
        return { name: label, path: at, folder: true, ignored: false };
    }

    /**
     * Its files by a last change made up from their place in the list, spread over today, the
     * week, the month and before; the `fresh` ones minutes ago, the first the newest.
     */
    recent(now: number, fresh: readonly string[]): RecentFiles {
        const dated = this.files.map((path, index) => {
            const at = fresh.indexOf(path);
            const age =
                at >= 0
                    ? (at + 1) * 3 * MINUTE
                    : (AGES[index % AGES.length] ?? 0) + (index % 50) * MINUTE;
            return { path, modified: now - age };
        });
        // `files` is sorted by path: a stable sort keeps that order within a time, as the backend
        dated.sort((a, b) => b.modified - a.modified);
        return {
            files: dated.slice(0, MAX_ENTRIES),
            more: Math.max(0, dated.length - MAX_ENTRIES),
            truncated: false,
        };
    }

    /** Whether `path` is a file the viewer shows: one of the tree, or an ignored one. */
    has(path: string): boolean {
        const { name, dir } = splitPath(path);
        const listed = this.folders.get(dir)?.files.includes(name) ?? false;
        return listed || (this.isIgnored(path) && this.ignoredFiles.includes(path));
    }
}

const MAX_ENTRIES = 10_000;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** How long ago the files not fresh changed, by their place in the list. */
const AGES = [2 * HOUR, 26 * HOUR, 3 * DAY, 5 * DAY, 12 * DAY, 24 * DAY, 90 * DAY, 400 * DAY];

/** The files of the Vault an agent just wrote, newest first. */
export const FRESH_VAULT_PATHS = ['journal/2026-10-24.md', 'ideas.md', 'images/screenshot.png'];
const byName = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }).compare;

/** A folder without git's tree, as its walk lists it. */
export function fixtureFolderTree() {
    return new FixtureTree(VAULT_PATHS);
}

/** The repository's tree, with the changed files in it and the deleted ones out. */
export function fixtureTree(large: boolean, changes: readonly ChangedFile[]) {
    const deleted = new Set(changes.filter((c) => c.kind === 'deleted').map((c) => c.path));
    const changed = changes.map((c) => c.path).filter((path) => !deleted.has(path));
    if (large) return new FixtureTree([...largePaths(), ...changed]);
    return new FixtureTree([...REVIEW_PATHS, ...changed], IGNORED_ENTRIES, IGNORED_FILES);
}

/** Lines that look like the file they are in. */
function textOf(path: string, lines: number): string {
    const body: string[] = [`// ${path}`, ''];
    for (let i = 1; body.length < lines; i++) {
        body.push(`export function step${i}(value: number): number {`);
        body.push(`\treturn value * ${i} + ${i % 7};`);
        body.push('}');
        body.push('');
    }
    return `${body.join('\n')}\n`;
}

/** The repository's own texts; its Markdown and the Vault's files are files (`fixture-files/`). */
const TEXTS: Record<string, string> = {
    ...FILE_TEXTS,
    '.gitignore': 'node_modules/\ndist/\n*.log\n',
    'src/cart/cart.ts':
        "import type { Item } from './index';\n\nexport interface Cart {\n\titems: Item[];\n\tcoupon: string | null;\n}\n",
};

/** A file of the tree, as the backend reads it. */
export function fixtureFileContent(path: string): FileContent {
    if (path.endsWith('.ico') || path.endsWith('.png')) return { kind: 'binary' };
    if (path === 'docs/latest.md') return { kind: 'link', target: 'architecture/overview.md' };
    if (path === 'vendor/payments-sdk') return { kind: 'folder' };
    if (path === 'generated/big.ts')
        return { kind: 'text', text: textOf(path, 60_000), truncated: true };
    const text = TEXTS[path] ?? textOf(path, 40);
    return { kind: 'text', text, truncated: false };
}
