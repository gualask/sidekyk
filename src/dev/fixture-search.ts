import type { ChangedFile } from '@/modules/repository';
import type {
    ContentEnd,
    ContentFile,
    Highlight,
    SearchRequest,
    SearchResults,
} from '@/modules/search';
import type { ChangeMark } from '@/shared/git/change-mark';
import type { ProjectInfo } from '@/shared/projects/project-info';

/**
 * A stand-in for the backend's ranking (`src-tauri/src/modules/search`): the query's letters in
 * order, case ignored, the earliest ones taken. No scoring: matches keep their order. Enough to
 * check the palette's UI on fixtures.
 */
function match(text: string, query: string): Highlight[] | null {
    const needle = query.toLowerCase().replace(/\s+/g, '');
    const haystack = text.toLowerCase();
    const runs: Highlight[] = [];
    let from = 0;
    for (const letter of needle) {
        const at = haystack.indexOf(letter, from);
        if (at < 0) return null;
        const last = runs.at(-1);
        if (last && last[1] === at) last[1] = at + 1;
        else runs.push([at, at + 1]);
        from = at + 1;
    }
    return runs;
}

/** As the backend's `FILE_LIMIT`. */
const FILE_LIMIT = 500;

/** As the backend's `marks_by_path`: an edit over a new file over a deletion. */
function marksByPath(changed: readonly ChangedFile[]): Map<string, ChangeMark> {
    const strength: ChangeMark[] = ['deleted', 'added', 'modified'];
    const marks = new Map<string, ChangeMark>();
    for (const file of changed) {
        const mark: ChangeMark =
            file.kind === 'deleted'
                ? 'deleted'
                : ['untracked', 'added', 'renamed', 'copied'].includes(file.kind)
                  ? 'added'
                  : 'modified';
        const before = marks.get(file.path);
        if (!before || strength.indexOf(mark) > strength.indexOf(before))
            marks.set(file.path, mark);
    }
    return marks;
}

export function fixtureSearch(
    request: SearchRequest,
    projects: readonly ProjectInfo[],
    files: { paths: readonly string[]; changed: readonly ChangedFile[] } | null,
): SearchResults {
    const query = request.query.trim();
    const results: SearchResults = { projects: [], panels: [], files: [], moreFiles: 0 };
    for (const project of projects) {
        const highlights = match(project.name, query);
        if (highlights) results.projects.push({ ...project, highlights });
    }
    request.panels.forEach((title, index) => {
        const highlights = match(title, query);
        if (highlights) results.panels.push({ index, highlights });
    });
    if (!query || !files) return results;
    const marks = marksByPath(files.changed);
    // a deleted file is not in the tree, but Changes lists it
    const deleted = files.changed
        .filter((file) => file.kind === 'deleted' && !files.paths.includes(file.path))
        .map((file) => file.path);
    for (const path of [...files.paths, ...deleted]) {
        const highlights = match(path, query);
        if (!highlights) continue;
        if (results.files.length < FILE_LIMIT) {
            results.files.push({ path, mark: marks.get(path) ?? null, highlights });
        } else {
            results.moreFiles += 1;
        }
    }
    return results;
}

/** As the backend's `MAX_LINES`. */
const CONTENT_LINE_LIMIT = 2_000;

/**
 * A stand-in for the backend's search in contents (`src-tauri/src/modules/search/contents.rs`):
 * literal, case ignored unless the text has a capital, line by line, stopping at the same limit.
 * Long lines are not cut. `read` gives a file's text, or null for one with none.
 */
export function fixtureContentSearch(
    paths: readonly string[],
    query: string,
    read: (path: string) => string | null,
): { files: ContentFile[]; end: ContentEnd } {
    const literal = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(literal, /\p{Lu}/u.test(query) ? 'gu' : 'giu');
    const files: ContentFile[] = [];
    let lines = 0;
    for (const path of paths) {
        const text = read(path);
        if (text === null) continue;
        const found: ContentFile = { path, lines: [] };
        for (const [index, line] of text.split('\n').entries()) {
            const highlights = [...line.matchAll(pattern)].map(
                (match): Highlight => [match.index, match.index + match[0].length],
            );
            if (highlights.length === 0) continue;
            if (lines === CONTENT_LINE_LIMIT) {
                if (found.lines.length > 0) files.push(found);
                return { files, end: { more: true, cancelled: false } };
            }
            lines += 1;
            found.lines.push({ number: index + 1, text: line, highlights });
        }
        if (found.lines.length > 0) files.push(found);
    }
    return { files, end: { more: false, cancelled: false } };
}
