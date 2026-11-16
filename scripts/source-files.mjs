// What the checks read: the repository's paths as their reports write them, and the files under a
// folder that a check takes.

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

export const ROOT_DIR = process.cwd();
export const SOURCE_DIR = path.join(ROOT_DIR, 'src');

/** A path from the repository's root, with `/` between names on every system. */
export function relativePath(filePath) {
    return path.relative(ROOT_DIR, filePath).split(path.sep).join('/');
}

/**
 * The files under `directory`, in the folders `enter` lets in, that `keep` takes; both are given
 * the entry's path from the root (`relativePath`).
 */
export async function filesUnder(directory, { enter, keep }) {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
        const entryPath = path.join(directory, entry.name);
        const relative = relativePath(entryPath);
        if (entry.isDirectory()) {
            if (enter(relative)) files.push(...(await filesUnder(entryPath, { enter, keep })));
        } else if (entry.isFile() && keep(relative)) {
            files.push(entryPath);
        }
    }
    return files;
}
