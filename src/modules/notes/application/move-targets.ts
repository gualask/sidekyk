import { createContext, createElement, type ReactNode, useContext } from 'react';
import type { ProjectInfo } from '@/shared/projects/project-info';

/**
 * Where notes can be moved, which the app knows for Notes: the projects, and the palette's ranking
 * of names (the Move dialog's suggestions).
 */
export interface MoveTargets {
    /** In the user's order. */
    projects: readonly ProjectInfo[];
    /** The names that match `query`, best first, by their index; with nothing typed, all. */
    rank: (query: string, names: readonly string[]) => Promise<number[]>;
}

const MoveTargetsContext = createContext<MoveTargets | null>(null);

export function MoveTargetsProvider({
    value,
    children,
}: {
    value: MoveTargets;
    children: ReactNode;
}) {
    return createElement(MoveTargetsContext.Provider, { value }, children);
}

export function useMoveTargets(): MoveTargets {
    const targets = useContext(MoveTargetsContext);
    if (!targets) {
        throw new Error('useMoveTargets must be used within MoveTargetsProvider');
    }
    return targets;
}
