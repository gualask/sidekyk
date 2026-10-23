import type { RuntimePorts } from '@/infrastructure/platform/runtime';
import { INBOX_BOOK } from '@/modules/notes';
import type { FolderChoice, ProjectList } from '@/modules/projects';
import type { GlobalShortcutStatus, Settings } from '@/modules/settings';
import { DEFAULT_COPY_TEMPLATE } from '@/shared/copy/copy-template';
import { type ProjectInfo, projectFolder } from '@/shared/projects/project-info';
import { commitActivity, commitFileDiff, commitFiles, recentCommits } from './commits.fixture-data';
import { fixtureFileContent, fixtureTree } from './files.fixture-data';
import { fixtureContentSearch, fixtureSearch } from './fixture-search';
import { largeDiff, largeSnapshot } from './large.fixture-data';
import { fixtureNotes } from './notes.fixture';
import { localProject, wslProject } from './projects.fixture';
import { FIXTURE_REPOSITORY, reviewDiff, reviewSnapshot } from './review.fixture-data';
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

/** The repository the folder picker finds, a folder inside it picked. */
const PICKED_REPOSITORY = {
    kind: 'usable',
    path: '/Users/dev/Projects/api-gateway/src',
    name: 'api-gateway',
    location: { kind: 'local', root: '/Users/dev/Projects/api-gateway' },
} as const satisfies FolderChoice;

/**
 * What the folder picker gives in turn, to see each answer of the New project dialog: a repository
 * no project follows, the scenario's own repository, then a folder that is no repository.
 */
const PICKED_FOLDERS: readonly ((list: ProjectList) => FolderChoice)[] = [
    () => PICKED_REPOSITORY,
    (list) =>
        list.projects.some((p) => p.id === FIXTURE_REPOSITORY.id)
            ? { kind: 'inProject', id: FIXTURE_REPOSITORY.id, name: FIXTURE_REPOSITORY.name }
            : { kind: 'notRepository' },
    () => ({ kind: 'notRepository' }),
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
        return [FIXTURE_REPOSITORY, CLEAN_PROJECTS[0], WSL_PROJECT, TOPIC_PROJECT];
    }
    if (scenario === 'problems') {
        return [FIXTURE_REPOSITORY, MISSING_PROJECT, STOPPED_PROJECT, GONE_PROJECT, NO_GIT_PROJECT];
    }
    if (scenario === 'clean') return [FIXTURE_REPOSITORY, TOPIC_PROJECT];
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

/** Browser-safe ports for `?dev=…` fixtures: fixed data, no native backend. */
export function createBrowserRuntimePorts(scenario: Scenario): RuntimePorts {
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
    const readable = (projectId: string) => {
        // missing where it was, not where Locate… finds it
        const folder = projectFolder(project(projectId));
        if (folder?.root === projectFolder(MISSING_PROJECT)?.root) {
            throw failure('repository_missing');
        }
        if (projectId === GONE_PROJECT.id) throw failure('distro_missing');
        if (projectId === NO_GIT_PROJECT.id) throw failure('git_not_found');
    };
    // as the backend: a card never starts a distro, opening a project starts it and the helper
    const running = new Set(['Ubuntu', 'Alpine']);
    const helpers = new Set<string>();
    const distroOf = (projectId: string) => {
        const folder = projectFolder(project(projectId));
        return folder?.kind === 'wsl' ? folder.distro : null;
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
        readable(projectId);
        let found = trees.get(projectId);
        if (!found) {
            found = fixtureTree(large(projectId), snapshot(projectId).files);
            trees.set(projectId, found);
        }
        return found;
    };

    // as the backend, the palette searches the files of the tree, as the last snapshot found them
    // changed: none when they cannot be read
    const searchedFiles = (projectId: string | null) => {
        if (!projectId) return null;
        try {
            return { paths: tree(projectId).files, changed: snapshot(projectId).files };
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
        projectsChanged: () => {
            for (const listener of projectsChanged) listener();
        },
    });
    // as the backend, the palette searches the notes of the project on screen
    const searchedNotes = (projectId: string | null) => {
        if (!projectId) return null;
        try {
            return notes.peek(projectId);
        } catch {
            return null;
        }
    };

    // the versions a diff compares, from the diffs and files served below
    const texts = (projectId: string): FixtureTexts => ({
        changeDiff: (area, path) => {
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

    return {
        notes,
        projects: {
            getProjects: async () => list,
            // no command line in the browser
            takeOpenedProject: async () => null,
            chooseProjectFolder: async () => {
                const picked = PICKED_FOLDERS[pickedFolders % PICKED_FOLDERS.length](list);
                pickedFolders += 1;
                return picked;
            },
            // as `ProjectList::add`, then on screen; a folder is the one picked, checked again
            createProject: async (name, folder) => {
                if (folder !== null && folder !== PICKED_REPOSITORY.path) {
                    throw failure('not_a_repository');
                }
                const location = folder === null ? null : PICKED_REPOSITORY.location;
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
            getSnapshot: async (projectId) => {
                readable(projectId);
                const distro = distroOf(projectId);
                if (distro && !helpers.has(distro)) {
                    await new Promise((started) => setTimeout(started, HELPER_START_MS));
                    helpers.add(distro);
                    running.add(distro);
                }
                return snapshot(projectId);
            },
            getSummary: async (projectId) => {
                readable(projectId);
                const distro = distroOf(projectId);
                if (distro && !helpers.has(distro) && !running.has(distro)) {
                    throw failure('distro_stopped');
                }
                return snapshot(projectId).summary;
            },
            getFileDiff: async (projectId, request) => {
                readable(projectId);
                if (!large(projectId)) return reviewDiff(request);
                return request.wholeFile ? wholeFileDiff(largeDiff()) : largeDiff();
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
            getFileContent: async (projectId, path) => {
                if (!tree(projectId).has(path)) throw failure('file_missing');
                return fixtureFileContent(path);
            },
            getSyntaxColors: async (projectId, { path, version, first, count }) => {
                readable(projectId);
                return fixtureColors(
                    fixtureVersionText(texts(projectId), path, version),
                    first,
                    count,
                );
            },
            onRepositoryChanged: () => () => undefined,
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
}
