import { createContext, useContext } from 'react';
import type { CompactWindowPort } from '@/shared/platform/compact-window';

const CompactWindowContext = createContext<CompactWindowPort | null>(null);

export const CompactWindowProvider = CompactWindowContext.Provider;

export function useCompactWindowPort(): CompactWindowPort {
    const port = useContext(CompactWindowContext);
    if (!port) throw new Error('useCompactWindowPort must be used within CompactWindowProvider');
    return port;
}
