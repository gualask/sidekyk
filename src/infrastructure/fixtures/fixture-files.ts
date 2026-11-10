import type { Diagram, DiagramRequest, MarkdownDocument } from '@/modules/repository';
import drawn from './fixture-files/diagrams.json';
import made from './fixture-files/previews.json';

/**
 * The fixtures' files that are files of their own (`fixture-files/`): the Vault's folder, the
 * shop's Markdown files, later versions of some (`edits/`). Their Markdown previews come from the
 * backend's parser (`previews.json`, written by the Rust test `fixture_previews`), so the fixtures
 * show what the app shows.
 */
interface Made {
    /** Each project's files and their sizes, by path; `images`, the repository's images. */
    sizes: Record<'vault' | 'shop' | 'images', Record<string, number>>;
    /** By the file's path from `fixture-files/`. */
    previews: Record<string, MarkdownDocument>;
}

const MADE = made as unknown as Made;

const TEXTS = import.meta.glob<string>(
    ['./fixture-files/**/*.{md,mmd,svg}', './fixture-files/vault/.ignore'],
    { query: '?raw', import: 'default', eager: true },
);

const IMAGE_URLS = import.meta.glob<string>(
    ['./fixture-files/vault/**/*.{png,svg}', './fixture-files/images/*.png'],
    { query: '?url', import: 'default', eager: true },
);

const PREFIX = './fixture-files/';

/** The ids of the fixtures' image objects: the logo added, the hero banner before its change. */
export const LOGO_BLOB = '5c1d0e7a9b3f4c2d8e6a1b0f7c3d9e2a4b6c8d01';
export const HERO_BLOB = '9e4b2a7c1d3f5e8a0b6c2d4f7a9e1b3c5d7f9a02';

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
export const VAULT_IMAGES: Record<string, FixtureImage> = Object.fromEntries(
    Object.entries(IMAGE_URLS).flatMap(([file, url]) => {
        if (!file.startsWith(`${PREFIX}vault/`)) return [];
        const path = file.slice(`${PREFIX}vault/`.length);
        return [[path, { url, size: MADE.sizes.vault[path] ?? 0 }]];
    }),
);

/** An image as Vite serves it, with its size on disk. */
interface FixtureImage {
    url: string;
    size: number;
}

/** One of `images/`, by its name there. */
function image(name: string): FixtureImage {
    return { url: IMAGE_URLS[`${PREFIX}images/${name}`] ?? '', size: MADE.sizes.images[name] ?? 0 };
}

/** The repository's images in its working tree, by path. */
export const REPOSITORY_IMAGES: Record<string, FixtureImage> = {
    'public/logo.png': image('logo.png'),
    'public/hero.png': image('hero-after.png'),
};

/** The git objects of the repository's images, by id: the review's and the commits' sides. */
export const FIXTURE_BLOBS: Record<string, FixtureImage> = {
    [LOGO_BLOB]: image('logo.png'),
    [HERO_BLOB]: image('hero-before.png'),
};

/** The preview of a Markdown text the fixtures hold, whichever file it is in; null for any other. */
export function fixturePreview(text: string): MarkdownDocument | null {
    for (const [file, preview] of Object.entries(MADE.previews)) {
        if (textAt(file) === text) return preview;
    }
    return null;
}

/**
 * The fixtures' diagrams as the backend draws them (`diagrams.json`, written by the Rust test
 * `fixture_diagrams`), in each theme, by their source; the font each carries is stored once, in
 * `styles`, its place in the SVG written `{{style:<index>}}`.
 */
interface Drawn {
    styles: string[];
    themes: Record<'light' | 'dark', Record<string, Diagram>>;
}

const DRAWN = drawn as unknown as Drawn;

/** A diagram the fixtures hold, as the backend draws it in the theme asked for. */
export function fixtureDiagram({ source, colors }: DiagramRequest): Diagram {
    const diagram = DRAWN.themes[colors.dark ? 'dark' : 'light'][source];
    if (!diagram) return { kind: 'invalid', detail: 'Not drawn in the fixtures (diagrams.json)' };
    return diagram.kind === 'drawn'
        ? {
              ...diagram,
              svg: diagram.svg.replace(
                  /\{\{style:(\d+)\}\}/,
                  (_, index: string) => DRAWN.styles[Number(index)] ?? '',
              ),
          }
        : diagram;
}

/** The later version of a file of a project (`edits/<project>/<path>`), if the fixtures have one. */
export function editedText(project: string, path: string): string | undefined {
    return textAt(`edits/${project.toLowerCase()}/${path}`);
}
