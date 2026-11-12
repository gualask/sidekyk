import { useState } from 'react';
import type { DiffView } from '@/shared/git/diff-view';
import { useRepositorySettings } from '../../application/repository-settings';

/** How a diff shows, and how it switches: the panel keeps the view across files. */
export interface DiffViewChoice {
    view: DiffView;
    /** The hunk to open on, after a switch; otherwise the first. */
    openOn: number | null;
    /** Switches the view, opening it on `hunk`. */
    onChange: (view: DiffView, hunk: number) => void;
}

/**
 * The view diffs show in: the settings' until the header switches it, and again once the setting
 * changes. A switch opens the new view on the hunk that was being read, as `openAt` opens a file
 * on a hunk; showing another file forgets it, so every file opens on its first change. The choice
 * is null until the settings are read.
 */
export function useDiffViewChoice(shownKey: string | null): {
    choice: DiffViewChoice | null;
    openAt: (file: string, hunk: number) => void;
} {
    const defaultView = useRepositorySettings().diffView;
    const [chosen, setChosen] = useState<{ view: DiffView; over: DiffView } | null>(null);
    const [switched, setSwitched] = useState<{ file: string | null; hunk: number } | null>(null);
    // another file shows: the hunk of the last switch was in the one before
    if (switched && switched.file !== shownKey) setSwitched(null);
    const openAt = (file: string, hunk: number) => setSwitched({ file, hunk });
    if (!defaultView) return { choice: null, openAt };
    const view = chosen?.over === defaultView ? chosen.view : defaultView;
    return {
        choice: {
            view,
            openOn: switched?.file === shownKey ? switched.hunk : null,
            onChange: (next, hunk) => {
                setChosen({ view: next, over: defaultView });
                setSwitched({ file: shownKey, hunk });
            },
        },
        openAt,
    };
}
