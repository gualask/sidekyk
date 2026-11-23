import type {
    FileContent,
    FolderKind,
    RepositoryChangedEvent,
    RepositoryPort,
} from '@/modules/repository';
import {
    allCommits,
    commitActivity,
    commitFileDiff,
    commitFiles,
    fixtureBranches,
    recentCommits,
} from './commits.fixture-data';
import { FRESH_VAULT_PATHS, fixtureFileContent } from './files.fixture-data';
import { editedText, FIXTURE_BLOBS, fixtureDiagram, fixturePreview } from './fixture-files';
import { type FixtureFolders, fixtureFolders } from './folders.fixture';
import { largeDiff } from './large.fixture-data';
import type { FixtureProjects } from './projects';
import { CLEAN_PROJECTS } from './projects.fixture-data';
import { fixtureIgnoringWhitespace, reviewDiff } from './review.fixture-data';
import { failure, type Scenario } from './scenario';
import { type FixtureTexts, fixtureColors, fixtureVersionText } from './syntax.fixture';
import { wholeFileDiff } from './whole-file.fixture';

/** The repository port, and what stands in for git, a distro and an agent in a folder. */
export interface FixtureRepository {
    port: RepositoryPort;
    folders: FixtureFolders;
    /** As `git init` (`repository`) or `.git` removed (`plain`) in a project's folder. */
    setKind: (name: string, kind: FolderKind) => void;
    /** As `wsl --shutdown` of the distro of the project of that name. */
    stopDistro: (name: string) => void;
    /** As an agent writing a file of the project of that name. */
    writeFile: (name: string, path: string, text?: string) => void;
}

export function fixtureRepository(
    scenario: Scenario,
    projects: FixtureProjects,
): FixtureRepository {
    const { shownOf } = projects;
    const folders = fixtureFolders(scenario, projects);
    const {
        scenarioData,
        large,
        kindOf,
        present,
        readable,
        readableWithoutStarting,
        startHelper,
        snapshot,
        tree,
        imagesOf,
    } = folders;

    // the versions a diff compares, from the diffs and files served below
    const texts = (folderId: string): FixtureTexts => ({
        changeDiff: (area, path) => {
            // a folder without git has no changes
            if (kindOf(folderId) === 'plain') return null;
            if (!snapshot(folderId).files.some((f) => f.area === area && f.path === path))
                return null;
            const diff = large(folderId)
                ? wholeFileDiff(largeDiff())
                : reviewDiff({ area, path, wholeFile: true });
            return diff.text;
        },
        fileText: (path) => {
            if (!tree(folderId).has(path)) return null;
            const content = fixtureFileContent(path);
            return content.kind === 'text' ? content.text : null;
        },
        commitDiff: (sha, path) => {
            for (const { sha: commitSha, parents } of allCommits(large(folderId))) {
                const parent = parents[0] ?? null;
                const side = commitSha === sha ? 'new' : parent === sha ? 'old' : null;
                if (!side) continue;
                const commit = { sha: commitSha, parent };
                const file = commitFiles(large(folderId), commit).files.find(
                    (f) => (side === 'new' ? f.path : (f.origPath ?? f.path)) === path,
                );
                if (!file) continue;
                const request = { commit, path: file.path, origPath: file.origPath };
                const diff = commitFileDiff(large(folderId), { ...request, wholeFile: true });
                return { text: wholeFileDiff(diff).text, side };
            }
            return null;
        },
    });

    // as the watcher tells a `.git` come or gone at a folder's root
    const repositoryChanged = new Set<(event: RepositoryChangedEvent) => void>();
    // files written while the page runs (`writeFile`), by project and path
    const written = new Map<string, string>();
    const contentOf = (folderId: string, path: string): FileContent => {
        if (!tree(folderId).has(path)) throw failure('file_missing');
        const text = written.get(`${folderId}\0${path}`);
        return text === undefined
            ? fixtureFileContent(path)
            : { kind: 'text', text, truncated: false };
    };
    const writeFile = (name: string, path: string, text = editedText(name, path)) => {
        if (text === undefined)
            throw new Error(`No later version of ${path} in fixture-files/edits`);
        const shown = shownOf(name);
        if (!shown) throw new Error(`No project ${name} with a folder`);
        written.set(`${shown.id}\0${path}`, text);
        const event: RepositoryChangedEvent = {
            version: 6,
            folderId: shown.id,
            gitDir: false,
            paths: [path],
            kindChanged: false,
            ignored: false,
        };
        for (const listener of repositoryChanged) listener(event);
    };

    const setKind = (name: string, kind: FolderKind) => {
        const shown = shownOf(name);
        if (!shown) throw new Error(`No project ${name} with a folder`);
        folders.setKind(shown.id, kind);
        const event: RepositoryChangedEvent = {
            version: 6,
            folderId: shown.id,
            gitDir: true,
            paths: null,
            kindChanged: true,
            ignored: false,
        };
        for (const listener of repositoryChanged) listener(event);
    };

    const stopDistro = (name: string) => {
        const shown = shownOf(name);
        if (shown) folders.stopDistro(shown.id);
    };

    const port: RepositoryPort = {
        // as the backend: no git, and only the Start panel starts a distro
        getFolderKind: async (folderId, start) => {
            present(folderId);
            if (start) await startHelper(folderId);
            else readableWithoutStarting(folderId);
            return kindOf(folderId);
        },
        getSnapshot: async (folderId) => {
            readable(folderId);
            await startHelper(folderId);
            return snapshot(folderId);
        },
        getSummary: async (folderId) => {
            readable(folderId);
            readableWithoutStarting(folderId);
            return snapshot(folderId).summary;
        },
        getFileDiff: async (folderId, request) => {
            readable(folderId);
            if (!large(folderId)) return reviewDiff(request);
            return request.wholeFile ? wholeFileDiff(largeDiff()) : largeDiff();
        },
        getChangesIgnoringWhitespace: async (folderId) => {
            readable(folderId);
            return fixtureIgnoringWhitespace(snapshot(folderId).files);
        },
        // every project has the same history, even with a clean working tree
        getRecentCommits: async (folderId, skip) => {
            readable(folderId);
            return recentCommits(large(folderId), skip);
        },
        getBranches: async (folderId) => {
            readable(folderId);
            return fixtureBranches(large(folderId));
        },
        // the review's changes would be overwritten by `main`; any other switch changes nothing
        switchBranch: async (folderId, request) => {
            readable(folderId);
            if (scenarioData(folderId) && !large(folderId) && request.name === 'main') {
                throw failure('branch_switch_blocked');
            }
        },
        getCommitActivity: async (folderId, since) => {
            readable(folderId);
            if (scenarioData(folderId)) {
                return commitActivity(large(folderId) ? 'large' : 'busy', since);
            }
            return commitActivity(folderId === CLEAN_PROJECTS[0].id ? 'quiet' : 'none', since);
        },
        getCommitFiles: async (folderId, commit) => {
            readable(folderId);
            return commitFiles(large(folderId), commit);
        },
        getCommitFileDiff: async (folderId, request) => {
            readable(folderId);
            const diff = commitFileDiff(large(folderId), request);
            return request.wholeFile ? wholeFileDiff(diff) : diff;
        },
        getDirectory: async (folderId, path) => tree(folderId).directory(path),
        // the changed files the newest, as an agent just wrote them
        getRecentFiles: async (folderId) => {
            const fresh =
                kindOf(folderId) === 'plain'
                    ? FRESH_VAULT_PATHS
                    : snapshot(folderId)
                          .files.filter((file) => file.kind !== 'deleted')
                          .map((file) => file.path);
            return tree(folderId).recent(Date.now(), fresh);
        },
        getFileContent: async (folderId, path) => contentOf(folderId, path),
        // as the backend: the folder on screen alone when it holds the file, else the others
        foldersHolding: async (projectId, first, path) => {
            const holds = (folderId: string) => {
                try {
                    readableWithoutStarting(folderId);
                    return tree(folderId).has(path);
                } catch {
                    return false;
                }
            };
            if (first !== null && holds(first)) return [first];
            const found = projects.list().projects.find((p) => p.id === projectId);
            if (!found) throw failure('project_not_found');
            return found.folders.map((f) => f.id).filter((id) => id !== first && holds(id));
        },
        // a file of the tree; an image's size as the fixtures have it, as Vite serves it
        getFileStamp: async (folderId, path) => {
            if (!tree(folderId).has(path)) throw failure('file_missing');
            return { size: imagesOf(folderId)[path]?.size ?? 0, modified: 0 };
        },
        getBlobSize: async (folderId, blob) => {
            readable(folderId);
            const image = FIXTURE_BLOBS[blob];
            if (!image) throw failure('file_missing');
            return image.size;
        },
        projectFileUrl: (folderId, path, source) =>
            (source.kind === 'blob' ? FIXTURE_BLOBS[source.blob] : imagesOf(folderId)[path])?.url ??
            '',
        getMarkdownPreview: async (folderId, path) => {
            // the backend's own preview of that text (`fixture-files/previews.json`)
            const content = contentOf(folderId, path);
            return content.kind === 'text' ? fixturePreview(content.text) : null;
        },
        // as the backend draws the fixtures' diagrams (`fixture-files/diagrams.json`)
        renderDiagram: async (request) => fixtureDiagram(request),
        // a browser tab opens it in another, as the system's browser would
        openUrl: async (url) => {
            window.open(url, '_blank', 'noopener,noreferrer');
        },
        getSyntaxColors: async (folderId, { path, version, first, count }) => {
            // as the backend: a file on disk is read without git
            if (version.kind === 'worktree') present(folderId);
            else readable(folderId);
            return fixtureColors(fixtureVersionText(texts(folderId), path, version), first, count);
        },
        onRepositoryChanged: (listener) => {
            repositoryChanged.add(listener);
            return () => repositoryChanged.delete(listener);
        },
        setWindowVisible: async () => null,
    };
    return {
        port,
        folders,
        setKind,
        stopDistro,
        writeFile,
    };
}
