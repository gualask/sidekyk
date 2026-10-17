import type { RuntimePorts } from '@/infrastructure/platform/runtime';
import type { ProjectList } from '@/modules/projects';
import type { GlobalShortcutStatus, Settings } from '@/modules/settings';
import { DEFAULT_COPY_TEMPLATE } from '@/shared/copy/copy-template';
import type { ProjectInfo } from '@/shared/projects/project-info';
import { commitFileDiff, commitFiles, recentCommits } from './commits.fixture-data';
import { fixtureFileContent, fixtureTree } from './files.fixture-data';
import { fixtureContentSearch, fixtureSearch } from './fixture-search';
import { largeDiff, largeSnapshot } from './large.fixture-data';
import { FIXTURE_REPOSITORY, reviewDiff, reviewSnapshot } from './review.fixture-data';
import { wholeFileDiff } from './whole-file.fixture';

export const SCENARIOS = ['review', 'clean', 'no-repo', 'large', 'problems'] as const;
export type Scenario = (typeof SCENARIOS)[number];

export function isScenario(value: string | null): value is Scenario {
    return SCENARIOS.includes(value as Scenario);
}

/** Projects with a clean working tree, next to the scenario's own. */
const CLEAN_PROJECTS: ProjectInfo[] = [
    { root: '/Users/dev/Projects/docs-site', name: 'docs-site' },
    { root: '/Users/dev/Projects/api-gateway', name: 'api-gateway' },
];

/** In `problems`: a project whose repository was moved or deleted after it was added. */
const MISSING_PROJECT: ProjectInfo = {
    root: '/Users/dev/Projects/old-prototype',
    name: 'old-prototype',
};

function initialProjects(scenario: Scenario): ProjectInfo[] {
    if (scenario === 'no-repo') return [];
    if (scenario === 'review') return [FIXTURE_REPOSITORY, CLEAN_PROJECTS[0]];
    if (scenario === 'problems') return [FIXTURE_REPOSITORY, MISSING_PROJECT];
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

/** Browser-safe ports for `?dev=…` fixtures: fixed data, no native backend. */
export function createBrowserRuntimePorts(scenario: Scenario): RuntimePorts {
    const projects = initialProjects(scenario);
    let list: ProjectList = { projects, active: projects[0]?.root ?? null };
    const project = (root: string) => {
        const found = list.projects.find((p) => p.root === root);
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
        theme: 'dark',
        globalShortcut: { enabled: true, keys: STORED_SHORTCUT },
        diffView: 'changes',
        copyTemplate: DEFAULT_COPY_TEMPLATE,
        sidebarWidths: {},
    };
    // in `problems`, another app holds the stored shortcut since startup
    const taken = scenario === 'problems' ? [...TAKEN_SHORTCUTS, STORED_SHORTCUT] : TAKEN_SHORTCUTS;
    let shortcutStatus: GlobalShortcutStatus = taken.includes(STORED_SHORTCUT)
        ? { kind: 'refused', keys: STORED_SHORTCUT }
        : { kind: 'active', keys: STORED_SHORTCUT, conflict: false };
    // the scenario's data belongs to its first project; any other is clean
    const scenarioData = (root: string) => root === FIXTURE_REPOSITORY.root && scenario !== 'clean';
    const readable = (root: string) => {
        project(root);
        if (root === MISSING_PROJECT.root) throw failure('repository_missing');
    };
    const large = (root: string) => scenario === 'large' && scenarioData(root);
    const snapshot = (root: string) => {
        readable(root);
        if (large(root)) return largeSnapshot();
        return reviewSnapshot(!scenarioData(root));
    };

    // as the backend, the tree is built once and kept: the fixtures never change on disk
    const trees = new Map<string, ReturnType<typeof fixtureTree>>();
    const tree = (root: string) => {
        readable(root);
        let found = trees.get(root);
        if (!found) {
            found = fixtureTree(large(root), snapshot(root).files);
            trees.set(root, found);
        }
        return found;
    };

    // as the backend, the palette searches the files of the tree, as the last snapshot found them
    // changed: none when they cannot be read
    const searchedFiles = (root: string | null) => {
        if (!root) return null;
        try {
            return { paths: tree(root).files, changed: snapshot(root).files };
        } catch {
            return null;
        }
    };

    return {
        projects: {
            getProjects: async () => list,
            addProject: async () => {
                // the folder picked is not in a repository
                if (scenario === 'problems') throw failure('not_a_repository');
                const added =
                    CLEAN_PROJECTS.find((p) => !list.projects.some((q) => q.root === p.root)) ??
                    FIXTURE_REPOSITORY;
                const known = list.projects.some((p) => p.root === added.root);
                return update({
                    projects: known ? list.projects : [...list.projects, added],
                    active: added.root,
                });
            },
            activateProject: async (root) => update({ ...list, active: project(root).root }),
            // as in `src-tauri/src/modules/projects/list.rs`: the next project shows, else the previous
            removeProject: async (root) => {
                const index = list.projects.indexOf(project(root));
                const projects = list.projects.filter((p) => p.root !== root);
                const next = projects[index] ?? projects.at(-1) ?? null;
                return update({
                    projects,
                    active: list.active === root ? (next?.root ?? null) : list.active,
                });
            },
            onProjectsChanged: () => () => undefined,
        },
        repository: {
            getSnapshot: async (root) => snapshot(root),
            getSummary: async (root) => snapshot(root).summary,
            getFileDiff: async (root, request) => {
                readable(root);
                const diff = large(root) ? largeDiff() : reviewDiff(request);
                return request.wholeFile ? wholeFileDiff(diff) : diff;
            },
            // every project has the same history, even with a clean working tree
            getRecentCommits: async (root) => {
                readable(root);
                return recentCommits(large(root));
            },
            getCommitFiles: async (root, commit) => {
                readable(root);
                return commitFiles(large(root), commit);
            },
            getCommitFileDiff: async (root, request) => {
                readable(root);
                const diff = commitFileDiff(large(root), request);
                return request.wholeFile ? wholeFileDiff(diff) : diff;
            },
            getDirectory: async (root, path) => tree(root).directory(path),
            getFileContent: async (root, path) => {
                if (!tree(root).has(path)) throw failure('file_missing');
                return fixtureFileContent(path);
            },
            onRepositoryChanged: () => () => undefined,
            setWindowVisible: async () => null,
        },
        search: {
            search: async (request) =>
                fixtureSearch(request, list.projects, searchedFiles(request.root)),
            searchContents: async (root, query, onFiles) => {
                const { files, end } = fixtureContentSearch(tree(root).files, query, (path) => {
                    const content = fixtureFileContent(path);
                    return content.kind === 'text' ? content.text : null;
                });
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
