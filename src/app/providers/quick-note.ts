import { createContext, useContext } from 'react';
import type { QuickNotePort } from '@/shared/platform/quick-note';

const QuickNoteContext = createContext<QuickNotePort | null>(null);

export const QuickNoteProvider = QuickNoteContext.Provider;

export function useQuickNotePort(): QuickNotePort {
    const port = useContext(QuickNoteContext);
    if (!port) throw new Error('useQuickNotePort must be used within QuickNoteProvider');
    return port;
}
