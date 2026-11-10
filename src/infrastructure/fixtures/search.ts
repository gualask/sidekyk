import { INBOX_BOOK } from '@/modules/notes';
import type { SearchPort } from '@/modules/search';
import { fixtureFileContent } from './files.fixture-data';
import {
    fixtureContentSearch,
    fixtureFileMatches,
    fixtureRankNames,
    fixtureSearch,
} from './fixture-search';
import type { FixtureNotes } from './notes';
import type { FixtureProjects } from './projects';
import type { FixtureFolders } from './repository';

/** As the backend's `SUGGESTED_FILE_LIMIT`: the files a note's `@` gets at most. */
const SUGGESTED_FILE_LIMIT = 20;

/** The search port over the projects, their folders and their notes. */
export function fixtureSearchPort(
    projects: FixtureProjects,
    folders: FixtureFolders,
    notes: FixtureNotes,
): SearchPort {
    // as the backend, the palette searches the notes of the project on screen, or at all projects
    // those of every book, the Inbox first
    const searchedNotes = (projectId: string | null) => {
        const books = projectId
            ? [projectId]
            : [INBOX_BOOK, ...projects.list().projects.map((p) => p.id)];
        return books.flatMap((book) => {
            try {
                return [[book, notes.peek(book)] as const];
            } catch {
                return [];
            }
        });
    };
    return {
        search: async (request) =>
            fixtureSearch(
                request,
                projects.list().projects,
                folders.searched(projects.shownFolderOf(request.projectId)),
                searchedNotes(request.projectId),
            ),
        searchContents: async (folderId, query, onFiles) => {
            folders.readableWithoutStarting(folderId);
            const { files, end } = fixtureContentSearch(
                folders.tree(folderId).files,
                query,
                (path) => {
                    const content = fixtureFileContent(path);
                    return content.kind === 'text' ? content.text : null;
                },
            );
            if (files.length > 0) onFiles(files);
            return end;
        },
        searchFiles: async (folderId, query) => {
            folders.readableWithoutStarting(folderId);
            const files = folders.searched(folderId);
            return query && files
                ? fixtureFileMatches(query, files, SUGGESTED_FILE_LIMIT)
                : { files: [], more: 0 };
        },
        stopContentSearch: async () => undefined,
        rankNames: async (query, names) => fixtureRankNames(query, names),
    };
}
