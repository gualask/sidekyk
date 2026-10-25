import type { MarkdownDocument } from '@/modules/repository';
import made from './fixture-files/previews.json';

/**
 * The fixtures' files that are files of their own (`fixture-files/`): the Vault's folder, the
 * shop's Markdown files, later versions of some (`edits/`). Their Markdown previews come from the
 * backend's parser (`previews.json`, written by the Rust test `fixture_previews`), so the fixtures
 * show what the app shows.
 */
interface Made {
    /** Each project's files and their sizes, by path. */
    sizes: Record<'vault' | 'shop', Record<string, number>>;
    /** By the file's path from `fixture-files/`. */
    previews: Record<string, MarkdownDocument>;
}

const MADE = made as unknown as Made;

const TEXTS = import.meta.glob<string>(
    ['./fixture-files/**/*.{md,svg}', './fixture-files/vault/.ignore'],
    { query: '?raw', import: 'default', eager: true },
);

const IMAGE_URLS = import.meta.glob<string>('./fixture-files/vault/**/*.{png,svg}', {
    query: '?url',
    import: 'default',
    eager: true,
});

const PREFIX = './fixture-files/';

/** A file's text, by its path from `fixture-files/`. */
function textAt(file: string): string | undefined {
    return TEXTS[`${PREFIX}${file}`];
}

/** The texts of a project's files, by their path in it. */
function projectTexts(project: 'vault' | 'shop'): Record<string, string> {
    const texts: Record<string, string> = {};
    for (const path of Object.keys(MADE.sizes[project])) {
        const text = textAt(`${project}/${path}`);
        if (text !== undefined) texts[path] = text;
    }
    return texts;
}

/** The Vault's files, as its walk lists them. */
export const VAULT_PATHS = Object.keys(MADE.sizes.vault);

/** The texts of the Vault's and the shop's files, by their path in the project. */
export const FILE_TEXTS: Record<string, string> = {
    ...projectTexts('shop'),
    ...projectTexts('vault'),
};

/** The Vault's images, as Vite serves them, with their size on disk. */
export const VAULT_IMAGES: Record<string, { url: string; size: number }> = Object.fromEntries(
    Object.entries(IMAGE_URLS).map(([file, url]) => {
        const path = file.slice(`${PREFIX}vault/`.length);
        return [path, { url, size: MADE.sizes.vault[path] ?? 0 }];
    }),
);

/** The preview of a Markdown text the fixtures hold, whichever file it is in; null for any other. */
export function fixturePreview(text: string): MarkdownDocument | null {
    for (const [file, preview] of Object.entries(MADE.previews)) {
        if (textAt(file) === text) return preview;
    }
    return null;
}

/** The later version of a file of a project (`edits/<project>/<path>`), if the fixtures have one. */
export function editedText(project: string, path: string): string | undefined {
    return textAt(`edits/${project.toLowerCase()}/${path}`);
}
