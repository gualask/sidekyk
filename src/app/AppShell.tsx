import { Suspense } from 'react';
import { INITIAL_PANEL } from './panels';

export function AppShell() {
    const panel = INITIAL_PANEL;

    return (
        <section className="h-full" aria-label={panel.title} data-panel={panel.id}>
            <Suspense fallback={null}>
                <panel.Component />
            </Suspense>
        </section>
    );
}
