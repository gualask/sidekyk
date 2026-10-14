import { createContext, createElement, type ReactNode, useContext } from 'react';
import type {
    FileDiff,
    FileDiffRequest,
    RepositoryChangedEvent,
    RepositorySnapshot,
    RepositorySummary,
} from '../model/repository.types';

/**
 * The repositories' runtime boundary: the native backend, or a fixture in browser dev mode. A
 * repository is named by its root, which must be a project the user added.
 */
export interface RepositoryPort {
    getSnapshot(root: string): Promise<RepositorySnapshot>;
    /** Branch, changed paths and line totals, cheap enough for every project on screen. */
    getSummary(root: string): Promise<RepositorySummary>;
    getFileDiff(root: string, request: FileDiffRequest): Promise<FileDiff>;
    /** Returns a synchronous disposer. */
    onRepositoryChanged(listener: (event: RepositoryChangedEvent) => void): () => void;
    /** While the window is hidden, changes on disk are not reported. Never fails. */
    setWindowVisible(visible: boolean): void;
}

const RepositoryPortContext = createContext<RepositoryPort | null>(null);

export function RepositoryProvider({
    value,
    children,
}: {
    value: RepositoryPort;
    children: ReactNode;
}) {
    return createElement(RepositoryPortContext.Provider, { value }, children);
}

export function useRepositoryPort(): RepositoryPort {
    const port = useContext(RepositoryPortContext);
    if (!port) {
        throw new Error('useRepositoryPort must be used within RepositoryProvider');
    }
    return port;
}
