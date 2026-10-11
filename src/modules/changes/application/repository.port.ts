import { createContext, createElement, type ReactNode, useContext } from 'react';
import type {
    FileDiff,
    FileDiffRequest,
    RepositoryChangedEvent,
    RepositoryInfo,
    RepositorySnapshot,
} from '../model/repository.types';

/** The repository's runtime boundary: the native backend, or a fixture in browser dev mode. */
export interface RepositoryPort {
    getActiveRepository(): Promise<RepositoryInfo | null>;
    /** Asks for a folder and opens its repository. null when the user cancels. */
    pickRepository(): Promise<RepositoryInfo | null>;
    getSnapshot(): Promise<RepositorySnapshot>;
    getFileDiff(request: FileDiffRequest): Promise<FileDiff>;
    /** Returns a synchronous disposer. */
    onRepositoryChanged(listener: (event: RepositoryChangedEvent) => void): () => void;
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
