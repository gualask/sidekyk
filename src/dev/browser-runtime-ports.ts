import type { RuntimePorts } from '@/infrastructure/platform/runtime';
import type { ProjectList } from '@/modules/projects';
import type { Settings } from '@/modules/settings';
import type { ProjectInfo } from '@/shared/projects/project-info';
import { largeDiff, largeSnapshot } from './large.fixture-data';
import { FIXTURE_REPOSITORY, reviewDiff, reviewSnapshot } from './review.fixture-data';

export const SCENARIOS = ['review', 'clean', 'no-repo', 'large'] as const;
export type Scenario = (typeof SCENARIOS)[number];

export function isScenario(value: string | null): value is Scenario {
    return SCENARIOS.includes(value as Scenario);
}

/** Projects with a clean working tree, next to the scenario's own. */
const CLEAN_PROJECTS: ProjectInfo[] = [
    { root: '/Users/dev/Projects/docs-site', name: 'docs-site' },
    { root: '/Users/dev/Projects/api-gateway', name: 'api-gateway' },
];

function initialProjects(scenario: Scenario): ProjectInfo[] {
    if (scenario === 'no-repo') return [];
    if (scenario === 'review') return [FIXTURE_REPOSITORY, CLEAN_PROJECTS[0]];
    return [FIXTURE_REPOSITORY];
}

/** Browser-safe ports for `?dev=…` fixtures: fixed data, no native backend. */
export function createBrowserRuntimePorts(scenario: Scenario): RuntimePorts {
    const projects = initialProjects(scenario);
    let list: ProjectList = { projects, active: projects[0]?.root ?? null };
    const project = (root: string) => {
        const found = list.projects.find((p) => p.root === root);
        if (!found) throw { code: 'project_not_found', message: 'project_not_found' };
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
        if (scenario === 'large' && scenarioData(root)) return largeSnapshot();
        return reviewSnapshot(!scenarioData(root));
    };

    return {
        projects: {
            getProjects: async () => list,
            addProject: async () => {
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
            getFileDiff: async (root, request) =>
                scenario === 'large' && scenarioData(root)
                    ? largeDiff(request)
                    : reviewDiff(request),
            onRepositoryChanged: () => () => undefined,
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
