import type { ChangedFile, Directory, FileContent, TreeEntry } from '@/modules/repository';
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
 * `src-tauri/crates/core/src/modules/repository/tree.rs`.
 */
class FixtureTree {
    private readonly folders = new Map<string, { folders: Set<string>; files: string[] }>();
    /** Every file's path, sorted: the palette searches them. */
    readonly files: readonly string[];

    constructor(paths: Iterable<string>) {
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

    directory(path: string): Directory {
        const folder = this.folders.get(path);
        if (!folder) return { entries: [], more: 0, truncated: false };
        const child = (name: string) => (path ? `${path}/${name}` : name);
        const folders = [...folder.folders].sort(byName).map((name): TreeEntry => {
            let label = name;
            let at = child(name);
            for (;;) {
                const inside = this.folders.get(at);
                const only = inside && inside.files.length === 0 ? [...inside.folders] : [];
                if (only.length !== 1 || !only[0]) break;
                label = `${label}/${only[0]}`;
                at = `${at}/${only[0]}`;
            }
            return { name: label, path: at, folder: true };
        });
        const files = [...new Set(folder.files)]
            .sort(byName)
            .map((name): TreeEntry => ({ name, path: child(name), folder: false }));
        const entries = [...folders, ...files];
        return {
            entries: entries.slice(0, MAX_ENTRIES),
            more: Math.max(0, entries.length - MAX_ENTRIES),
            truncated: false,
        };
    }

    has(path: string): boolean {
        const slash = path.lastIndexOf('/');
        const folder = this.folders.get(slash < 0 ? '' : path.slice(0, slash));
        return folder?.files.includes(path.slice(slash + 1)) ?? false;
    }
}

const MAX_ENTRIES = 10_000;
const byName = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }).compare;

/** A folder without git's tree, as its walk lists it. */
export function fixtureFolderTree() {
    return new FixtureTree(VAULT_PATHS);
}

/** The repository's tree, with the changed files in it and the deleted ones out. */
export function fixtureTree(large: boolean, changes: readonly ChangedFile[]) {
    const deleted = new Set(changes.filter((c) => c.kind === 'deleted').map((c) => c.path));
    const changed = changes.map((c) => c.path).filter((path) => !deleted.has(path));
    return new FixtureTree([...(large ? largePaths() : REVIEW_PATHS), ...changed]);
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
