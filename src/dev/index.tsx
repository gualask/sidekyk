import { useState } from 'react';
import { AppShell } from '@/app/AppShell';
import { AppProviders } from '@/app/providers';
import { createBrowserRuntimePorts, isScenario, SCENARIOS } from './browser-runtime-ports';

/**
 * Browser dev mode: `?dev=app&scenario=review|clean|no-repo` renders the real app on fixture
 * data, so a UI change can be checked without Tauri or a real repository.
 */
export function DevModePage() {
    const scenario = new URLSearchParams(window.location.search).get('scenario');
    const [runtime] = useState(() =>
        createBrowserRuntimePorts(isScenario(scenario) ? scenario : 'review'),
    );

    if (scenario !== null && !isScenario(scenario)) {
        return (
            <p className="p-6 text-sm">
                Unknown scenario “{scenario}”. Try one of: {SCENARIOS.join(', ')}.
            </p>
        );
    }

    return (
        <AppProviders runtime={runtime}>
            <AppShell />
        </AppProviders>
    );
}
