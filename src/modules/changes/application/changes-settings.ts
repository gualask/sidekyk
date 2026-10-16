import { createContext, createElement, type ReactNode, useContext } from 'react';
import type { DiffView } from '@/shared/git/diff-view';

/** What the Changes panel takes from the settings, which the app reads for it. */
export interface ChangesSettings {
    /** The view a diff opens in; null until the settings are read. */
    diffView: DiffView | null;
    /** What a copy from a diff puts on the clipboard. */
    copyTemplate: string;
}

const ChangesSettingsContext = createContext<ChangesSettings | null>(null);

export function ChangesSettingsProvider({
    value,
    children,
}: {
    value: ChangesSettings;
    children: ReactNode;
}) {
    return createElement(ChangesSettingsContext.Provider, { value }, children);
}

export function useChangesSettings(): ChangesSettings {
    const settings = useContext(ChangesSettingsContext);
    if (!settings) {
        throw new Error('useChangesSettings must be used within ChangesSettingsProvider');
    }
    return settings;
}
