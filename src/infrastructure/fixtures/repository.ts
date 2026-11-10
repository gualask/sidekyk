import type {
    ChangedFile,
    FileContent,
    FolderKind,
    RepositoryChangedEvent,
    RepositoryPort,
} from '@/modules/repository';
import { projectFolder } from '@/shared/projects/project-info';
import { commitActivity, commitFileDiff, commitFiles, recentCommits } from './commits.fixture-data';
import {
    FRESH_VAULT_PATHS,
    fixtureFileContent,
    fixtureFolderTree,
    fixtureTree,
} from './files.fixture-data';
import {
    editedText,
    FIXTURE_BLOBS,
    fixtureDiagram,
    fixturePreview,
    REPOSITORY_IMAGES,
    VAULT_IMAGES,
} from './fixture-files';
import { largeDiff, largeSnapshot } from './large.fixture-data';
import {
    CLEAN_PROJECTS,
    DOCUMENT_ROOTS,
    type FixtureProjects,
    GONE_PROJECT,
    MISSING_PROJECT,
    NO_GIT_PROJECT,
} from './projects';
import { fixtureIgnoringWhitespace, reviewDiff, reviewSnapshot } from './review.fixture-data';
import { failure, hasScenarioData, isLarge, type Scenario } from './scenario';
import { type FixtureTexts, fixtureColors, fixtureVersionText } from './syntax.fixture';
import { wholeFileDiff } from './whole-file.fixture';

/** How long Sidekyk's helper takes to start in a distro, as the first read of a WSL project waits. */
const HELPER_START_MS = 1500;

type FixtureTree = ReturnType<typeof fixtureTree>;

/** What the search reads of a folder, as the backend's palette and content search do. */
export interface FixtureFolders {
    /** `distro_stopped` unless the folder's distro runs, as `readable_without_starting`. */
    readableWithoutStarting: (folderId: string) => void;
    tree: (folderId: string) => FixtureTree;
    /**
     * The files of the tree the palette searches, as the last snapshot found them changed: none
     * when they cannot be read.
     */
    searched: (
        folderId: string | null,
    ) => { paths: readonly string[]; changed: readonly ChangedFile[] } | null;
}

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
    const { folder, shownOf } = projects;
    const scenarioData = (folderId: string) => hasScenarioData(scenario, folderId);
    const large = (folderId: string) => isLarge(scenario, folderId);
    const rootOf = (folderId: string) => folder(folderId).root;
    // what is a folder without git, by its root: `gitInit` and `gitRemove` change it
    const plainRoots = new Set(DOCUMENT_ROOTS);
    const kindOf = (folderId: string): FolderKind =>
        plainRoots.has(rootOf(folderId)) ? 'plain' : 'repository';
    // the folder is there, no git asked
    const present = (folderId: string) => {
        // missing where it was, not where Locate… finds it
        if (rootOf(folderId) === projectFolder(MISSING_PROJECT)?.root) {
            throw failure('repository_missing');
        }
        if (folderId === GONE_PROJECT.id) throw failure('distro_missing');
    };
    // a repository git can read: the frontend never asks a folder without git
    const readable = (folderId: string) => {
        present(folderId);
        if (folderId === NO_GIT_PROJECT.id) throw failure('git_not_found');
        if (kindOf(folderId) === 'plain') throw failure('unknown');
    };
    // as the backend: the kind and the summary never start a distro, the Start panel does; a
    // distro running gets its helper started by the first read
    const running = new Set(['Ubuntu', 'Alpine']);
    const helpers = new Set<string>();
    const distroOf = (folderId: string) => {
        const found = folder(folderId);
        return found.kind === 'wsl' ? found.distro : null;
    };
    const readableWithoutStarting = (folderId: string) => {
        const distro = distroOf(folderId);
        if (distro && !helpers.has(distro) && !running.has(distro)) {
            throw failure('distro_stopped');
        }
    };
    // the helper takes a while the first time, the distro started with it
    const startHelper = async (folderId: string) => {
        const distro = distroOf(folderId);
        if (distro && !helpers.has(distro)) {
            await new Promise((started) => setTimeout(started, HELPER_START_MS));
            helpers.add(distro);
            running.add(distro);
        }
    };
    const snapshot = (folderId: string) => {
        readable(folderId);
        if (large(folderId)) return largeSnapshot();
        return reviewSnapshot(!scenarioData(folderId));
    };

    // a folder without git holds the Vault's images, the repository its own
    const imagesOf = (folderId: string) =>
        DOCUMENT_ROOTS.includes(rootOf(folderId)) ? VAULT_IMAGES : REPOSITORY_IMAGES;

    // as the backend, the tree is built once and kept: the fixtures never change on disk
    const trees = new Map<string, FixtureTree>();
    const tree = (folderId: string) => {
        present(folderId);
        let found = trees.get(folderId);
        if (!found) {
            found = DOCUMENT_ROOTS.includes(rootOf(folderId))
                ? fixtureFolderTree()
                : fixtureTree(large(folderId), snapshot(folderId).files);
            trees.set(folderId, found);
        }
        return found;
    };

    const searched = (folderId: string | null) => {
        if (!folderId) return null;
        try {
            readableWithoutStarting(folderId);
            const changed = kindOf(folderId) === 'plain' ? [] : snapshot(folderId).files;
            return { paths: tree(folderId).files, changed };
        } catch {
            return null;
        }
    };

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
            for (const { sha: commitSha, parent } of recentCommits(large(folderId)).commits) {
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
            version: 5,
            folderId: shown.id,
            gitDir: false,
            paths: [path],
            kindChanged: false,
        };
        for (const listener of repositoryChanged) listener(event);
    };

    const setKind = (name: string, kind: FolderKind) => {
        const shown = shownOf(name);
        if (!shown) throw new Error(`No project ${name} with a folder`);
        if (kind === 'plain') plainRoots.add(shown.root);
        else plainRoots.delete(shown.root);
        const event: RepositoryChangedEvent = {
            version: 5,
            folderId: shown.id,
            gitDir: true,
            paths: null,
            kindChanged: true,
        };
        for (const listener of repositoryChanged) listener(event);
    };

    const stopDistro = (name: string) => {
        const shown = shownOf(name);
        const distro = shown ? distroOf(shown.id) : null;
        if (!distro) return;
        running.delete(distro);
        helpers.delete(distro);
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
        getRecentCommits: async (folderId) => {
            readable(folderId);
            return recentCommits(large(folderId));
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
        folders: { readableWithoutStarting, tree, searched },
        setKind,
        stopDistro,
        writeFile,
    };
}
