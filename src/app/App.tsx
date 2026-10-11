import { lazy, Suspense } from 'react';
import { AppProviders } from '@/app/providers';

import { AppShell } from './AppShell';

const DevModePage = import.meta.env.DEV
    ? lazy(() => import('@/dev').then((module) => ({ default: module.DevModePage })))
    : null;

function hasDevFixtureRequest(search: string): boolean {
    if (!import.meta.env.DEV) return false;

    return Boolean(new URLSearchParams(search).get('dev')?.trim());
}

function App() {
    if (DevModePage && hasDevFixtureRequest(window.location.search)) {
        return (
            <Suspense fallback={null}>
                <DevModePage />
            </Suspense>
        );
    }

    return (
        <AppProviders>
            <AppShell />
        </AppProviders>
    );
}

export default App;
