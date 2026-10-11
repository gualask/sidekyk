import type { RuntimePorts } from '@/infrastructure/platform/runtime';
import type { RepositoryInfo } from '@/modules/changes';
import { FIXTURE_REPOSITORY, reviewDiff, reviewSnapshot } from './review.fixture-data';

export const SCENARIOS = ['review', 'clean', 'no-repo'] as const;
export type Scenario = (typeof SCENARIOS)[number];

export function isScenario(value: string | null): value is Scenario {
    return SCENARIOS.includes(value as Scenario);
}

/** Browser-safe ports for `?dev=…` fixtures: fixed data, no native backend. */
export function createBrowserRuntimePorts(scenario: Scenario): RuntimePorts {
    let active: RepositoryInfo | null = scenario === 'no-repo' ? null : FIXTURE_REPOSITORY;

    return {
        repository: {
            getActiveRepository: async () => active,
            pickRepository: async () => {
                active = FIXTURE_REPOSITORY;
                return active;
            },
            getSnapshot: async () => reviewSnapshot(scenario === 'clean'),
            getFileDiff: async (request) => reviewDiff(request),
            onRepositoryChanged: () => () => undefined,
        },
    };
}
