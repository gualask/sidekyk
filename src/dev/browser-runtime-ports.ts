import type { RuntimePorts } from '@/infrastructure/platform/runtime';
import type { ProjectList } from '@/modules/projects';
import type { Settings } from '@/modules/settings';
import type { ProjectInfo } from '@/shared/projects/project-info';
import { fixtureSearch } from './fixture-search';
import { largeDiff, largeSnapshot } from './large.fixture-data';
import { FIXTURE_REPOSITORY, reviewDiff, reviewSnapshot } from './review.fixture-data';

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
    let settings: Settings = { theme: 'dark' };
    // the scenario's data belongs to its first project; any other is clean
    const scenarioData = (root: string) => root === FIXTURE_REPOSITORY.root && scenario !== 'clean';
    const snapshot = (root: string) => {
        project(root);
        if (root === MISSING_PROJECT.root) throw failure('repository_missing');
        if (scenario === 'large' && scenarioData(root)) return largeSnapshot();
        return reviewSnapshot(!scenarioData(root));
    };

    // as the backend, the palette searches the files of the last snapshot: none when it failed
    const snapshotFiles = (root: string) => {
        try {
            return snapshot(root).files;
        } catch {
            return [];
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
                if (root === MISSING_PROJECT.root) throw failure('repository_missing');
                return scenario === 'large' && scenarioData(root)
                    ? largeDiff(request)
                    : reviewDiff(request);
            },
            onRepositoryChanged: () => () => undefined,
            setWindowVisible: () => undefined,
        },
        search: {
            search: async (request) => {
                const files = list.active ? snapshotFiles(list.active) : [];
                return fixtureSearch(request, list.projects, files);
            },
        },
        settings: {
            getSettings: async () => settings,
            setSettings: async (next) => {
                settings = next;
                return settings;
            },
        },
        // a browser tab draws no window controls over the page
        titleBar: { overlaid: false, onOverlaidChange: () => () => undefined },
        // the browser console already shows them
        reportError: () => undefined,
    };
}
