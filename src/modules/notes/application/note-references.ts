import { createContext, createElement, type ReactNode, useContext, useMemo } from 'react';
import type { Matched } from '@/shared/format/highlight-parts';
import { type NamedLines, type NoteEntity, noteEntities } from '../model/entities';

/** A file a note's `@` suggests: its path, and where the letters typed are in it. */
export interface SuggestedFile {
    path: string;
    highlights: Matched;
}

/** The files a note can name: those of one folder, searched by name, best first. */
interface NamedFiles {
    /** The folder's id: what the files searched are cached by. */
    folder: string;
    search: (query: string) => Promise<SuggestedFile[]>;
}

/**
 * Where a note's references lead, which the app knows: the files of the folder on screen, and
 * opening a file or a web address (`docs/features/note-references.md`).
 */
export interface NoteReferences {
    /**
     * The files a note of `book` names; null where its notes name no files: the Inbox, a project
     * without a folder or not on screen, a folder that cannot be read without starting its WSL
     * distro.
     */
    filesOf: (book: string) => NamedFiles | null;
    /**
     * Opens a file a note of `book` names, at its lines if it names some: in the folder on
     * screen, else in the project's other folder that has it. Says so when none has it (moved,
     * deleted), never fails.
     */
    openFile: (book: string, path: string, lines: NamedLines | null) => void;
    /** Opens a web address in the browser. */
    openUrl: (url: string) => void;
}

const NoteReferencesContext = createContext<NoteReferences | null>(null);

export function NoteReferencesProvider({
    value,
    children,
}: {
    value: NoteReferences;
    children: ReactNode;
}) {
    return createElement(NoteReferencesContext.Provider, { value }, children);
}

export function useNoteReferences(): NoteReferences {
    const references = useContext(NoteReferencesContext);
    if (!references) {
        throw new Error('useNoteReferences must be used within NoteReferencesProvider');
    }
    return references;
}

/** The entities of a note of `book`: files only where its notes name files, addresses always. */
export function useNoteEntities(book: string, text: string): NoteEntity[] {
    const named = useNoteReferences().filesOf(book) !== null;
    return useMemo(() => {
        const entities = noteEntities(text);
        return named ? entities : entities.filter((entity) => entity.kind === 'link');
    }, [text, named]);
}

/** Opens what an entity of a note of `book` points at. */
export function useOpenEntity(book: string): (entity: NoteEntity) => void {
    const references = useNoteReferences();
    return (entity) => {
        if (entity.kind === 'link') references.openUrl(entity.url);
        else references.openFile(book, entity.path, entity.lines);
    };
}
