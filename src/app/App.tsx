import { lazy, Suspense } from 'react';
import { AppProviders } from '@/app/providers';
import { createTranslator, detectLocale, formatTag } from '@/shared/i18n';
import { CrashNotice } from '@/shared/ui/CrashNotice';
import { ErrorBoundary } from '@/shared/ui/ErrorBoundary';

import { AppShell } from './app-shell/AppShell';

const DevModePage = import.meta.env.DEV
    ? lazy(() => import('./DevModePage').then((module) => ({ default: module.DevModePage })))
    : null;

function hasDevFixtureRequest(search: string): boolean {
    if (!import.meta.env.DEV) return false;

    return Boolean(new URLSearchParams(search).get('dev')?.trim());
}

function App() {
    return (
        <ErrorBoundary fallback={({ error }) => <WindowCrash error={error} />}>
            {DevModePage && hasDevFixtureRequest(window.location.search) ? (
                <Suspense fallback={null}>
                    <DevModePage />
                </Suspense>
            ) : (
                <AppProviders>
                    <AppShell />
                </AppProviders>
            )}
        </ErrorBoundary>
    );
}

/**
 * What the window shows when something outside a panel broke: a reload brings the page back,
 * the backend and what it saved untouched. In the language the app chose, read from the page
 * (`data-locale`), not the providers, which may be what broke.
 */
function WindowCrash({ error }: { error: unknown }) {
    // the language the app chose, once it did; before, the system's (`index.html` says `en`)
    const chosen = document.documentElement.dataset.locale;
    const languages = chosen ? [chosen, ...navigator.languages] : navigator.languages;
    const locale = detectLocale(languages);
    const i18n = createTranslator(locale, formatTag(locale, navigator.languages));
    return (
        <div className="h-full bg-ui-surface">
            <CrashNotice
                i18n={i18n}
                title={i18n.t('crash.window')}
                hint={i18n.t('crash.windowHint')}
                error={error}
                action={{ label: i18n.t('crash.reload'), run: () => window.location.reload() }}
            />
        </div>
    );
}

export default App;
