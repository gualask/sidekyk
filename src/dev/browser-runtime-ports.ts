import type { RuntimePorts } from '@/infrastructure/platform/runtime';
import { INBOX_BOOK } from '@/modules/notes';
import type { FolderChoice, ProjectList } from '@/modules/projects';
import type { FileContent, FolderKind, RepositoryChangedEvent } from '@/modules/repository';
import type { GlobalShortcutStatus, Settings } from '@/modules/settings';
import { DEFAULT_COPY_TEMPLATE } from '@/shared/copy/copy-template';
import { type ProjectInfo, projectFolder } from '@/shared/projects/project-info';
import { commitActivity, commitFileDiff, commitFiles, recentCommits } from './commits.fixture-data';
import { fixtureFileContent, fixtureFolderTree, fixtureTree } from './files.fixture-data';
import { editedText, fixturePreview, VAULT_IMAGES } from './fixture-files';
import { fixtureContentSearch, fixtureRankNames, fixtureSearch } from './fixture-search';
import { largeDiff, largeSnapshot } from './large.fixture-data';
import { fixtureNotes } from './notes.fixture';
import { localProject, wslProject } from './projects.fixture';
import {
    FIXTURE_REPOSITORY,
    fixtureIgnoringWhitespace,
    reviewDiff,
    reviewSnapshot,
} from './review.fixture-data';
import { type FixtureTexts, fixtureColors, fixtureVersionText } from './syntax.fixture';
import { wholeFileDiff } from './whole-file.fixture';

export const SCENARIOS = ['review', 'clean', 'no-repo', 'large', 'problems'] as const;
export type Scenario = (typeof SCENARIOS)[number];

export function isScenario(value: string | null): value is Scenario {
    return SCENARIOS.includes(value as Scenario);
}

/** Projects with a clean working tree, next to the scenario's own. */
const CLEAN_PROJECTS: ProjectInfo[] = [
    localProject('/Users/dev/Projects/docs-site', 'docs-site'),
    localProject('/Users/dev/Projects/api-gateway', 'api-gateway'),
];

/** In `review`: a clone of the scenario's repository in a WSL distro, clean, of the same name. */
const WSL_PROJECT = wslProject('Ubuntu', '/home/dev/shop', 'shop');

/** In `review` and `clean`: a project without folder, notes on a topic. */
const TOPIC_PROJECT: ProjectInfo = { id: 'b0000000000000a1', name: 'Thesis', folders: [] };

/** In `review` and `clean`: a folder without git, notes in Markdown (`sidekykDev.gitInit`). */
const VAULT_ROOT = '/Users/dev/Notes/vault';
const VAULT_PROJECT = localProject(VAULT_ROOT, 'Vault');

/** The repository the folder picker finds, a folder inside it picked. */
const PICKED_REPOSITORY = {
    kind: 'usable',
    path: '/Users/dev/Projects/api-gateway/src',
    name: 'api-gateway',
    location: { kind: 'local', root: '/Users/dev/Projects/api-gateway' },
} as const satisfies FolderChoice;

/** A folder without git the folder picker finds. */
const PICKED_PLAIN = {
    kind: 'usable',
    path: '/Users/dev/Documents/papers',
    name: 'papers',
    location: { kind: 'local', root: '/Users/dev/Documents/papers' },
} as const satisfies FolderChoice;

/** The folders without git, until `sidekykDev.gitInit`: they list notes in Markdown. */
const DOCUMENT_ROOTS: readonly string[] = [VAULT_ROOT, PICKED_PLAIN.location.root];

/**
 * What the folder picker gives in turn, to see each answer of the New project dialog: a repository
 * no project follows, the scenario's own repository, then a folder without git.
 */
const PICKED_FOLDERS: readonly ((list: ProjectList) => FolderChoice)[] = [
    () => PICKED_REPOSITORY,
    (list) =>
        list.projects.some((p) => p.id === FIXTURE_REPOSITORY.id)
            ? { kind: 'inProject', id: FIXTURE_REPOSITORY.id, name: FIXTURE_REPOSITORY.name }
            : PICKED_PLAIN,
    () => PICKED_PLAIN,
];

/** In `problems`: a project whose repository was moved or deleted after it was added. */
const MISSING_PROJECT = localProject('/Users/dev/Projects/old-prototype', 'old-prototype');

/**
 * In `problems`, WSL projects: a distro that does not run (until the project opens), one gone, one
 * without git.
 */
const STOPPED_PROJECT = wslProject('Debian', '/home/dev/api', 'api');
const GONE_PROJECT = wslProject('Arch', '/home/dev/dotfiles', 'dotfiles');
const NO_GIT_PROJECT = wslProject('Alpine', '/home/dev/tools', 'tools');

/** How long Sidekyk's helper takes to start in a distro, as the first read of a WSL project waits. */
const HELPER_START_MS = 1500;

function initialProjects(scenario: Scenario): ProjectInfo[] {
    if (scenario === 'no-repo') return [];
    if (scenario === 'review') {
        return [FIXTURE_REPOSITORY, CLEAN_PROJECTS[0], WSL_PROJECT, VAULT_PROJECT, TOPIC_PROJECT];
    }
    if (scenario === 'problems') {
        return [FIXTURE_REPOSITORY, MISSING_PROJECT, STOPPED_PROJECT, GONE_PROJECT, NO_GIT_PROJECT];
    }
    if (scenario === 'clean') return [FIXTURE_REPOSITORY, VAULT_PROJECT, TOPIC_PROJECT];
    return [FIXTURE_REPOSITORY];
}

/** Shortcuts macOS keeps on by default: registered, but macOS gets them first. */
const MACOS_SHORTCUTS = ['Super+Space', 'Alt+Super+Space', 'Control+Super+Space'];

/** As the system answers, to see the warning: `⇧⌘Space` held by another app. */
const TAKEN_SHORTCUTS = ['Shift+Super+Space'];

const STORED_SHORTCUT = 'Control+Alt+Space';

/** A native command's failure, as the backend sends it. */
function failure(code: string) {
    return { code, message: code };
}

let projectSeq = 0;
/** 16 hex digits, as the backend's new project ids. */
function newProjectId(): string {
    projectSeq += 1;
    return (0xa0000000 + projectSeq).toString(16).padStart(16, '0');
}

/** The fixtures' runtime: the ports, and what stands in for the command line. */
export interface BrowserRuntime {
    ports: RuntimePorts;
    /**
     * As `sidekyk <folder>` (`open_folder`): the project of that name, else one added for a folder
     * of that name; on screen, and the frontend told the list changed.
     */
    openFolder: (name: string) => void;
    /** As `git init` in the folder of the project of that name, its watcher telling the change. */
    gitInit: (name: string) => void;
    /** As its `.git` removed. */
    gitRemove: (name: string) => void;
    /** As `wsl --shutdown` of the distro of the project of that name: started again by a read. */
    stopDistro: (name: string) => void;
    /**
     * As an agent writing a file of the project of that name, its watcher telling the change:
     * `text`, or the fixtures' later version of it (`fixture-files/edits/`), whose preview is
     * the backend's.
     */
    writeFile: (name: string, path: string, text?: string) => void;
}

/** Browser-safe ports for `?dev=…` fixtures: fixed data, no native backend. */
export function createBrowserRuntime(scenario: Scenario): BrowserRuntime {
    const projects = initialProjects(scenario);
    let list: ProjectList = { projects, active: projects[0]?.id ?? null, layouts: {} };
    const project = (projectId: string) => {
        const found = list.projects.find((p) => p.id === projectId);
        if (!found) throw failure('project_not_found');
        return found;
    };
    const update = (next: ProjectList) => {
        list = next;
        return list;
    };
    // a browser tab follows the system's theme, or the one the devtools emulate: the setting is
    // only kept
    let settings: Settings = {
        language: null,
        theme: 'dark',
        globalShortcut: { enabled: true, keys: STORED_SHORTCUT },
        diffView: 'changes',
        fileView: 'preview',
        diffScrollbar: 'narrow',
        codeLines: 'scroll',
        copyTemplate: DEFAULT_COPY_TEMPLATE,
        sidebarWidths: {},
        noteLines: 'wrap',
    };
    // in `problems`, another app holds the stored shortcut since startup
    const taken = scenario === 'problems' ? [...TAKEN_SHORTCUTS, STORED_SHORTCUT] : TAKEN_SHORTCUTS;
    let shortcutStatus: GlobalShortcutStatus = taken.includes(STORED_SHORTCUT)
        ? { kind: 'refused', keys: STORED_SHORTCUT }
        : { kind: 'active', keys: STORED_SHORTCUT, conflict: false };
    // the scenario's data belongs to its first project; any other is clean
    const scenarioData = (projectId: string) =>
        projectId === FIXTURE_REPOSITORY.id && scenario !== 'clean';
    const rootOf = (projectId: string) => projectFolder(project(projectId))?.root ?? '';
    // what is a folder without git, by its root: `gitInit` and `gitRemove` change it
    const plainRoots = new Set(DOCUMENT_ROOTS);
    const kindOf = (projectId: string): FolderKind =>
        plainRoots.has(rootOf(projectId)) ? 'plain' : 'repository';
    // the folder is there, no git asked
    const present = (projectId: string) => {
        // missing where it was, not where Locate… finds it
        if (rootOf(projectId) === projectFolder(MISSING_PROJECT)?.root) {
            throw failure('repository_missing');
        }
        if (projectId === GONE_PROJECT.id) throw failure('distro_missing');
    };
    // a repository git can read: the frontend never asks a folder without git
    const readable = (projectId: string) => {
        present(projectId);
        if (projectId === NO_GIT_PROJECT.id) throw failure('git_not_found');
        if (kindOf(projectId) === 'plain') throw failure('unknown');
    };
    // as the backend: the kind and the summary never start a distro, the Start panel does; a
    // distro running gets its helper started by the first read
    const running = new Set(['Ubuntu', 'Alpine']);
    const helpers = new Set<string>();
    const distroOf = (projectId: string) => {
        const folder = projectFolder(project(projectId));
        return folder?.kind === 'wsl' ? folder.distro : null;
    };
    // `distro_stopped` unless the project's distro runs, as `readable_without_starting`
    const readableWithoutStarting = (projectId: string) => {
        const distro = distroOf(projectId);
        if (distro && !helpers.has(distro) && !running.has(distro)) {
            throw failure('distro_stopped');
        }
    };
    // the helper takes a while the first time, the distro started with it
    const startHelper = async (projectId: string) => {
        const distro = distroOf(projectId);
        if (distro && !helpers.has(distro)) {
            await new Promise((started) => setTimeout(started, HELPER_START_MS));
            helpers.add(distro);
            running.add(distro);
        }
    };
    const large = (projectId: string) => scenario === 'large' && scenarioData(projectId);
    const snapshot = (projectId: string) => {
        readable(projectId);
        if (large(projectId)) return largeSnapshot();
        return reviewSnapshot(!scenarioData(projectId));
    };

    // as the backend, the tree is built once and kept: the fixtures never change on disk
    const trees = new Map<string, ReturnType<typeof fixtureTree>>();
    const tree = (projectId: string) => {
        present(projectId);
        let found = trees.get(projectId);
        if (!found) {
            found = DOCUMENT_ROOTS.includes(rootOf(projectId))
                ? fixtureFolderTree()
                : fixtureTree(large(projectId), snapshot(projectId).files);
            trees.set(projectId, found);
        }
        return found;
    };

    // as the backend, the palette searches the files of the tree, as the last snapshot found them
    // changed: none when they cannot be read
    const searchedFiles = (projectId: string | null) => {
        if (!projectId) return null;
        try {
            readableWithoutStarting(projectId);
            const changed = kindOf(projectId) === 'plain' ? [] : snapshot(projectId).files;
            return { paths: tree(projectId).files, changed };
        } catch {
            return null;
        }
    };

    // as in `src-tauri/crates/core/src/modules/projects/list.rs`: a project removed takes its
    // notes; when on screen, the next project shows, else the previous
    const removeProject = (projectId: string) => {
        const index = list.projects.indexOf(project(projectId));
        notes.drop(projectId);
        const projects = list.projects.filter((p) => p.id !== projectId);
        const next = projects[index] ?? projects.at(-1) ?? null;
        const { [projectId]: _gone, ...layouts } = list.layouts;
        return update({
            projects,
            active: list.active === projectId ? (next?.id ?? null) : list.active,
            layouts,
        });
    };
    const projectsChanged = new Set<() => void>();
    const tellProjectsChanged = () => {
        for (const listener of projectsChanged) listener();
    };
    // the project a folder given on the command line put on screen, until the app takes it
    let opened: string | null = null;
    // how many folders the picker gave, for the next answer of `PICKED_FOLDERS`
    let pickedFolders = 0;
    // as the backend, notes need the Inbox or a project in the list, not its repository: a moved
    // one's stay
    const notes = fixtureNotes({
        initial: (book) => {
            if (book === INBOX_BOOK) {
                return scenario === 'review' || scenario === 'clean' ? 'inbox' : 'empty';
            }
            if (book === TOPIC_PROJECT.id) return 'topic';
            if (!scenarioData(book)) return 'empty';
            return large(book) ? 'large' : 'review';
        },
        checkBook: (book) => {
            if (book !== INBOX_BOOK) project(book);
        },
        // as `ProjectList::add`: last, without folder, on screen only when none was
        makeProject: (name) => {
            const made: ProjectInfo = { id: newProjectId(), name: name.trim(), folders: [] };
            const active = list.active ?? made.id;
            update({ ...list, projects: [...list.projects, made], active });
            return made.id;
        },
        dropProject: removeProject,
        projectsChanged: tellProjectsChanged,
    });
    // as the backend, the palette searches the notes of the project on screen, or at all projects
    // those of every book, the Inbox first
    const searchedNotes = (projectId: string | null) => {
        const books = projectId ? [projectId] : [INBOX_BOOK, ...list.projects.map((p) => p.id)];
        return books.flatMap((book) => {
            try {
                return [[book, notes.peek(book)] as const];
            } catch {
                return [];
            }
        });
    };

    // the versions a diff compares, from the diffs and files served below
    const texts = (projectId: string): FixtureTexts => ({
        changeDiff: (area, path) => {
            // a folder without git has no changes
            if (kindOf(projectId) === 'plain') return null;
            if (!snapshot(projectId).files.some((f) => f.area === area && f.path === path))
                return null;
            const diff = large(projectId)
                ? wholeFileDiff(largeDiff())
                : reviewDiff({ area, path, wholeFile: true });
            return diff.text;
        },
        fileText: (path) => {
            if (!tree(projectId).has(path)) return null;
            const content = fixtureFileContent(path);
            return content.kind === 'text' ? content.text : null;
        },
        commitDiff: (sha, path) => {
            for (const { sha: commitSha, parent } of recentCommits(large(projectId)).commits) {
                const side = commitSha === sha ? 'new' : parent === sha ? 'old' : null;
                if (!side) continue;
                const commit = { sha: commitSha, parent };
                const file = commitFiles(large(projectId), commit).files.find(
                    (f) => (side === 'new' ? f.path : (f.origPath ?? f.path)) === path,
                );
                if (!file) continue;
                const request = { commit, path: file.path, origPath: file.origPath };
                const diff = commitFileDiff(large(projectId), { ...request, wholeFile: true });
                return { text: wholeFileDiff(diff).text, side };
            }
            return null;
        },
    });

    // as the watcher tells a `.git` come or gone at a folder's root
    const repositoryChanged = new Set<(event: RepositoryChangedEvent) => void>();
    // files written while the page runs (`writeFile`), by project and path
    const written = new Map<string, string>();
    const contentOf = (projectId: string, path: string): FileContent => {
        if (!tree(projectId).has(path)) throw failure('file_missing');
        const text = written.get(`${projectId}\0${path}`);
        return text === undefined
            ? fixtureFileContent(path)
            : { kind: 'text', text, truncated: false };
    };
    const writeFile = (name: string, path: string, text = editedText(name, path)) => {
        const found = list.projects.find((p) => p.name === name);
        if (!found) throw new Error(`No project ${name}`);
        if (text === undefined)
            throw new Error(`No later version of ${path} in fixture-files/edits`);
        written.set(`${found.id}\0${path}`, text);
        const event: RepositoryChangedEvent = {
            version: 4,
            projectId: found.id,
            gitDir: false,
            paths: [path],
            kindChanged: false,
        };
        for (const listener of repositoryChanged) listener(event);
    };

    const setKind = (name: string, kind: FolderKind) => {
        const found = list.projects.find((p) => p.name === name);
        const root = found ? projectFolder(found)?.root : undefined;
        if (!found || !root) throw new Error(`No project ${name} with a folder`);
        if (kind === 'plain') plainRoots.add(root);
        else plainRoots.delete(root);
        const event: RepositoryChangedEvent = {
            version: 4,
            projectId: found.id,
            gitDir: true,
            paths: null,
            kindChanged: true,
        };
        for (const listener of repositoryChanged) listener(event);
    };

    const openFolder = (name: string) => {
        const found = list.projects.find((p) => p.name === name);
        const shown: ProjectInfo = found ?? {
            id: newProjectId(),
            name,
            folders: [{ kind: 'local', root: `/Users/dev/Projects/${name}` }],
        };
        const projects = found ? list.projects : [...list.projects, shown];
        update({ ...list, projects, active: shown.id });
        opened = shown.id;
        tellProjectsChanged();
    };

    const ports: RuntimePorts = {
        notes,
        projects: {
            getProjects: async () => list,
            takeOpenedProject: async () => {
                const taken = opened;
                opened = null;
                return taken;
            },
            chooseProjectFolder: async () => {
                const picked = PICKED_FOLDERS[pickedFolders % PICKED_FOLDERS.length](list);
                pickedFolders += 1;
                return picked;
            },
            // as `ProjectList::add`, then on screen; a folder is the one picked, checked again
            createProject: async (name, folder) => {
                const picked = [PICKED_REPOSITORY, PICKED_PLAIN].find((p) => p.path === folder);
                if (folder !== null && !picked) throw failure('repository_missing');
                const location = picked?.location ?? null;
                if (
                    location &&
                    list.projects.some((p) => projectFolder(p)?.root === location.root)
                ) {
                    throw failure('unknown');
                }
                const made: ProjectInfo = {
                    id: newProjectId(),
                    name: name.trim(),
                    folders: location ? [location] : [],
                };
                return update({ ...list, projects: [...list.projects, made], active: made.id });
            },
            renameProject: async (projectId, name) => {
                const renamed = project(projectId);
                return update({
                    ...list,
                    projects: list.projects.map((p) =>
                        p === renamed ? { ...p, name: name.trim() } : p,
                    ),
                });
            },
            activateProject: async (projectId) =>
                update({ ...list, active: project(projectId).id }),
            removeProject: async (projectId) => removeProject(projectId),
            // in `problems`, the moved project is found next to where it was; it keeps its id
            relocateProject: async (projectId) => {
                const moved = project(projectId);
                const folder = projectFolder(moved);
                if (!folder) throw new Error(`${moved.name} follows no folder`);
                const root = `${folder.root}-moved`;
                const other = list.projects.find((p) => projectFolder(p)?.root === root);
                if (other) return { kind: 'inProject', id: other.id, name: other.name };
                const folders = [{ kind: 'local' as const, root }];
                return {
                    kind: 'moved',
                    list: update({
                        ...list,
                        projects: list.projects.map((p) => (p === moved ? { ...p, folders } : p)),
                    }),
                };
            },
            setProjectLayout: async (projectId, layout) =>
                update({ ...list, layouts: { ...list.layouts, [project(projectId).id]: layout } }),
            onProjectsChanged: (listener) => {
                projectsChanged.add(listener);
                // once as the listening starts, as the backend's adapter
                queueMicrotask(() => {
                    if (projectsChanged.has(listener)) listener();
                });
                return () => projectsChanged.delete(listener);
            },
        },
        repository: {
            // as the backend: no git, and only the Start panel starts a distro
            getFolderKind: async (projectId, start) => {
                present(projectId);
                if (start) await startHelper(projectId);
                else readableWithoutStarting(projectId);
                return kindOf(projectId);
            },
            getSnapshot: async (projectId) => {
                readable(projectId);
                await startHelper(projectId);
                return snapshot(projectId);
            },
            getSummary: async (projectId) => {
                readable(projectId);
                readableWithoutStarting(projectId);
                return snapshot(projectId).summary;
            },
            getFileDiff: async (projectId, request) => {
                readable(projectId);
                if (!large(projectId)) return reviewDiff(request);
                return request.wholeFile ? wholeFileDiff(largeDiff()) : largeDiff();
            },
            getChangesIgnoringWhitespace: async (projectId) => {
                readable(projectId);
                return fixtureIgnoringWhitespace(snapshot(projectId).files);
            },
            // every project has the same history, even with a clean working tree
            getRecentCommits: async (projectId) => {
                readable(projectId);
                return recentCommits(large(projectId));
            },
            getCommitActivity: async (projectId, since) => {
                readable(projectId);
                if (scenarioData(projectId)) {
                    return commitActivity(large(projectId) ? 'large' : 'busy', since);
                }
                return commitActivity(projectId === CLEAN_PROJECTS[0].id ? 'quiet' : 'none', since);
            },
            getCommitFiles: async (projectId, commit) => {
                readable(projectId);
                return commitFiles(large(projectId), commit);
            },
            getCommitFileDiff: async (projectId, request) => {
                readable(projectId);
                const diff = commitFileDiff(large(projectId), request);
                return request.wholeFile ? wholeFileDiff(diff) : diff;
            },
            getDirectory: async (projectId, path) => tree(projectId).directory(path),
            getFileContent: async (projectId, path) => contentOf(projectId, path),
            // the fixtures' images, as Vite serves them; any other is missing
            getFileStamp: async (projectId, path) => {
                if (!tree(projectId).has(path) || !(path in VAULT_IMAGES)) {
                    throw failure('file_missing');
                }
                return { size: VAULT_IMAGES[path].size, modified: 0 };
            },
            projectFileUrl: (_projectId, path) => VAULT_IMAGES[path]?.url ?? '',
            getMarkdownPreview: async (projectId, path) => {
                // the backend's own preview of that text (`fixture-files/previews.json`)
                const content = contentOf(projectId, path);
                return content.kind === 'text' ? fixturePreview(content.text) : null;
            },
            // a browser tab opens it in another, as the system's browser would
            openUrl: async (url) => {
                window.open(url, '_blank', 'noopener,noreferrer');
            },
            getSyntaxColors: async (projectId, { path, version, first, count }) => {
                // as the backend: a file on disk is read without git
                if (version.kind === 'worktree') present(projectId);
                else readable(projectId);
                return fixtureColors(
                    fixtureVersionText(texts(projectId), path, version),
                    first,
                    count,
                );
            },
            onRepositoryChanged: (listener) => {
                repositoryChanged.add(listener);
                return () => repositoryChanged.delete(listener);
            },
            setWindowVisible: async () => null,
        },
        search: {
            search: async (request) =>
                fixtureSearch(
                    request,
                    list.projects,
                    searchedFiles(request.projectId),
                    searchedNotes(request.projectId),
                ),
            searchContents: async (projectId, query, onFiles) => {
                readableWithoutStarting(projectId);
                const { files, end } = fixtureContentSearch(
                    tree(projectId).files,
                    query,
                    (path) => {
                        const content = fixtureFileContent(path);
                        return content.kind === 'text' ? content.text : null;
                    },
                );
                if (files.length > 0) onFiles(files);
                return end;
            },
            stopContentSearch: async () => undefined,
            rankNames: async (query, names) => fixtureRankNames(query, names),
        },
        settings: {
            getSettings: async () => settings,
            // as the backend: the shortcut's settings unchanged change nothing, even refused
            setSettings: async (next) => {
                const { enabled, keys } = next.globalShortcut;
                const changed =
                    enabled !== settings.globalShortcut.enabled ||
                    keys !== settings.globalShortcut.keys;
                if (changed) {
                    if (enabled && taken.includes(keys)) throw failure('shortcut_taken');
                    shortcutStatus = enabled
                        ? { kind: 'active', keys, conflict: MACOS_SHORTCUTS.includes(keys) }
                        : { kind: 'off' };
                }
                settings = next;
                return settings;
            },
            getGlobalShortcutStatus: async () => shortcutStatus,
            setShortcutRecording: async () => undefined,
        },
        // a browser tab draws no window controls over the page
        titleBar: { overlaid: false, onOverlaidChange: () => () => undefined },
        // the browser console already shows them
        reportError: () => undefined,
        showWindow: () => undefined,
    };
    return {
        ports,
        openFolder,
        gitInit: (name) => setKind(name, 'repository'),
        gitRemove: (name) => setKind(name, 'plain'),
        writeFile,
        stopDistro: (name) => {
            const found = list.projects.find((p) => p.name === name);
            const distro = found ? distroOf(found.id) : null;
            if (!distro) return;
            running.delete(distro);
            helpers.delete(distro);
        },
    };
}
