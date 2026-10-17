import { createContext, createElement, type ReactNode, useContext } from 'react';
import type { DiffView } from '@/shared/git/diff-view';

/** What the Changes and Files panels take from the settings, which the app reads for them. */
export interface RepositorySettings {
    /** The view a diff opens in; null until the settings are read. */
    diffView: DiffView | null;
    /** What a copy from a diff puts on the clipboard. */
    copyTemplate: string;
    /** The Files panel's tree, in pixels, as last dragged; null for its default. */
    filesTreeWidth: number | null;
    /** Stores the tree's width; null goes back to the default. */
    setFilesTreeWidth: (width: number | null) => void;
}

const RepositorySettingsContext = createContext<RepositorySettings | null>(null);

export function RepositorySettingsProvider({
    value,
    children,
}: {
    value: RepositorySettings;
    children: ReactNode;
}) {
    return createElement(RepositorySettingsContext.Provider, { value }, children);
}

export function useRepositorySettings(): RepositorySettings {
    const settings = useContext(RepositorySettingsContext);
    if (!settings) {
        throw new Error('useRepositorySettings must be used within RepositorySettingsProvider');
    }
    return settings;
}
