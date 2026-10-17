import type { ChangedFile } from '@/modules/repository';
import type { Highlight, SearchRequest, SearchResults } from '@/modules/search';
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
