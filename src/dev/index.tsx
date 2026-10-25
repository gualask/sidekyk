import { useEffect, useState } from 'react';
import { AppShell } from '@/app/AppShell';
import { AppProviders } from '@/app/providers';
import { createBrowserRuntime, isScenario, SCENARIOS } from './browser-runtime-ports';

/**
 * Browser dev mode: `?dev=app&scenario=review|clean|no-repo|large|problems` renders the real app
 * on fixture data, so a UI change can be checked without Tauri or a real repository. `&open=<name>`
 * and `sidekykDev.openFolder(<name>)` stand in for the command line; `sidekykDev.gitInit(<name>)`
 * and `gitRemove(<name>)` for `git init` and `.git` removed in a project's folder;
 * `sidekykDev.stopDistro(<name>)` for `wsl --shutdown` of a WSL project's distro;
 * `sidekykDev.writeFile(<name>, <path>, <text>?)` for an agent writing a file, its later version
 * in `fixture-files/edits/` without a text (`docs/testing.md`).
 */
export function DevModePage() {
    const params = new URLSearchParams(window.location.search);
    const scenario = params.get('scenario');
    const [runtime] = useState(() => {
        const made = createBrowserRuntime(isScenario(scenario) ? scenario : 'review');
        const open = params.get('open');
        if (open) made.openFolder(open);
        return made;
    });
    // in an effect: the runtime kept, not the one of a second call StrictMode makes and drops
    useEffect(() => {
        const { openFolder, gitInit, gitRemove, stopDistro, writeFile } = runtime;
        Object.assign(window, {
            sidekykDev: { openFolder, gitInit, gitRemove, stopDistro, writeFile },
        });
    }, [runtime]);

    if (scenario !== null && !isScenario(scenario)) {
        return (
            <p className="p-6 text-sm">
                Unknown scenario “{scenario}”. Try one of: {SCENARIOS.join(', ')}.
            </p>
        );
    }

    return (
        <AppProviders runtime={runtime.ports}>
            <AppShell />
        </AppProviders>
    );
}
