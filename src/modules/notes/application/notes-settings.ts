import { createContext, createElement, type ReactNode, useContext } from 'react';
import type { NoteLines } from '@/shared/notes/note-lines';

/** What Notes takes from the settings, which the app reads and stores for it. */
export interface NotesSettings {
    lines: NoteLines;
    setLines: (lines: NoteLines) => void;
}

const NotesSettingsContext = createContext<NotesSettings | null>(null);

export function NotesSettingsProvider({
    value,
    children,
}: {
    value: NotesSettings;
    children: ReactNode;
}) {
    return createElement(NotesSettingsContext.Provider, { value }, children);
}

export function useNotesSettings(): NotesSettings {
    const settings = useContext(NotesSettingsContext);
    if (!settings) {
        throw new Error('useNotesSettings must be used within NotesSettingsProvider');
    }
    return settings;
}

/**
 * The keys a note's text field takes besides typing: `⌥Z` switches how long lines show, as in VS
 * Code. Matched on the key's place (`code`): `⌥Z` types a character on macOS.
 */
export function onNoteFieldKey(
    event: {
        altKey: boolean;
        metaKey: boolean;
        ctrlKey: boolean;
        code: string;
        preventDefault: () => void;
    },
    settings: NotesSettings,
): boolean {
    if (!event.altKey || event.metaKey || event.ctrlKey || event.code !== 'KeyZ') return false;
    event.preventDefault();
    settings.setLines(settings.lines === 'wrap' ? 'scroll' : 'wrap');
    return true;
}
