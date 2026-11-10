import { FIXTURE_REPOSITORY } from './review.fixture-data';

export const SCENARIOS = ['review', 'clean', 'no-repo', 'large', 'problems'] as const;
export type Scenario = (typeof SCENARIOS)[number];

export function isScenario(value: string | null): value is Scenario {
    return SCENARIOS.includes(value as Scenario);
}

/**
 * Whether the folder holds the scenario's data: its first project, and its folder, of the same id;
 * any other is clean.
 */
export function hasScenarioData(scenario: Scenario, folderId: string): boolean {
    return folderId === FIXTURE_REPOSITORY.id && scenario !== 'clean';
}

/** Whether the folder holds the `large` scenario's data. */
export function isLarge(scenario: Scenario, folderId: string): boolean {
    return scenario === 'large' && hasScenarioData(scenario, folderId);
}

/** A native command's failure, as the backend sends it. */
export function failure(code: string) {
    return { code, message: code };
}
