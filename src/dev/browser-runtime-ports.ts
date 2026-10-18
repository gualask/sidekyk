import type { RuntimePorts } from '@/infrastructure/platform/runtime';
import type { ProjectList } from '@/modules/projects';
import type { GlobalShortcutStatus, Settings } from '@/modules/settings';
import { DEFAULT_COPY_TEMPLATE } from '@/shared/copy/copy-template';
import type { ProjectInfo } from '@/shared/projects/project-info';
import { commitFileDiff, commitFiles, recentCommits } from './commits.fixture-data';
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
    if (scenario === 'review') return [FIXTURE_REPOSITORY, CLEAN_PROJECTS[0], WSL_PROJECT];
    if (scenario === 'problems') {
        return [FIXTURE_REPOSITORY, MISSING_PROJECT, STOPPED_PROJECT, GONE_PROJECT, NO_GIT_PROJECT];
    }
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
        theme: 'dark',
        globalShortcut: { enabled: true, keys: STORED_SHORTCUT },
        diffView: 'changes',
        diffScrollbar: 'narrow',
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
        project(projectId);
        if (projectId === MISSING_PROJECT.id) throw failure('repository_missing');
        if (projectId === GONE_PROJECT.id) throw failure('distro_missing');
        if (projectId === NO_GIT_PROJECT.id) throw failure('git_not_found');
    };
    // as the backend: a card never starts a distro, opening a project starts it and the helper
    const running = new Set(['Ubuntu', 'Alpine']);
    const helpers = new Set<string>();
    const distroOf = (projectId: string) => {
        const { location } = project(projectId);
        return location.kind === 'wsl' ? location.distro : null;
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

    // as the backend, notes need the project in the list, not its repository: a moved one's stay
    const notes = fixtureNotes(
        (projectId) => (!scenarioData(projectId) ? 'empty' : large(projectId) ? 'large' : 'review'),
        (projectId) => {
            project(projectId);
        },
    );
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
            addProject: async () => {
                // the folder picked is not in a repository
                if (scenario === 'problems') throw failure('not_a_repository');
                const added =
                    CLEAN_PROJECTS.find((p) => !list.projects.some((q) => q.id === p.id)) ??
                    FIXTURE_REPOSITORY;
                const known = list.projects.some((p) => p.id === added.id);
                return update({
                    ...list,
                    projects: known ? list.projects : [...list.projects, added],
                    active: added.id,
                });
            },
            activateProject: async (projectId) =>
                update({ ...list, active: project(projectId).id }),
            // as in `src-tauri/crates/core/src/modules/projects/list.rs`: the next project shows,
            // else the previous
            removeProject: async (projectId) => {
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
            },
            // in `problems`, the moved project is found next to where it was
            relocateProject: async (projectId) => {
                const moved = project(projectId);
                const found = localProject(`${moved.location.root}-moved`, moved.name);
                notes.relink(moved.id, found.id);
                const { [moved.id]: layout, ...layouts } = list.layouts;
                return update({
                    projects: list.projects.map((p) => (p === moved ? found : p)),
                    active: list.active === moved.id ? found.id : list.active,
                    layouts: layout ? { ...layouts, [found.id]: layout } : layouts,
                });
            },
            setProjectLayout: async (projectId, layout) =>
                update({ ...list, layouts: { ...list.layouts, [project(projectId).id]: layout } }),
            onProjectsChanged: () => () => undefined,
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
