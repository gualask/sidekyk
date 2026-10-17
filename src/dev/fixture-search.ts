import type { ChangedFile } from '@/modules/repository';
import type { Highlight, SearchRequest, SearchResults } from '@/modules/search';
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

export function fixtureSearch(
    request: SearchRequest,
    projects: readonly ProjectInfo[],
    files: readonly ChangedFile[],
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
    if (!query) return results;
    for (const file of files) {
        const highlights = match(file.path, query);
        if (!highlights) continue;
        if (results.files.length < FILE_LIMIT) {
            results.files.push({ path: file.path, area: file.area, highlights });
        } else {
            results.moreFiles += 1;
        }
    }
    return results;
}
