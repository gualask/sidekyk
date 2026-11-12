import { useCallback, useState } from 'react';
import type { PaletteMode } from '@/modules/search';
import type { ProjectInfo } from '@/shared/projects/project-info';

/** The command palette: whether it is open, what it looks for, and the text it opens with. */
interface PaletteState {
    /** Null until first opened; then it stays mounted, to give the focus back as it closes. */
    open: boolean | null;
    mode: PaletteMode;
    /** Empty, or a find bar's text taken to the project's files. */
    text: string;
}

const PALETTE_UNOPENED: PaletteState = { open: null, mode: 'names', text: '' };

/** The palette closed, if it was open, as the settings open in its place. */
const closePalette = (palette: PaletteState): PaletteState =>
    palette.open ? { ...palette, open: false } : palette;

/** Which dialogs are open over the workspace, and the ways to open and close them. */
export type Dialogs = ReturnType<typeof useDialogs>;

/**
 * The dialogs over the workspace: the settings, the command palette, the shortcuts, and a
 * project's to remove or to edit. One at a time where they meet: the palette and the settings
 * close each other.
 */
export function useDialogs() {
    // null until first opened; then the dialogs stay mounted, to give the focus back as they close
    const [settingsOpen, setSettingsOpen] = useState<boolean | null>(null);
    const [palette, setPalette] = useState(PALETTE_UNOPENED);
    const [helpOpen, setHelpOpen] = useState(false);
    // a project to remove, once asked what to do with its notes
    const [removing, setRemoving] = useState<ProjectInfo | null>(null);
    // a project whose name and folders change: from its row, or from its folders in the top bar
    const [editing, setEditing] = useState<ProjectInfo | null>(null);
    // a problem's fix in the settings: they open in place of the palette
    const openSettings = useCallback(() => {
        setPalette(closePalette);
        setSettingsOpen(true);
    }, []);

    return {
        settingsOpen,
        setSettingsOpen,
        palette,
        setPalette,
        helpOpen,
        setHelpOpen,
        removing,
        setRemoving,
        editing,
        setEditing,
        openSettings,
        toggleSettings: () => {
            setPalette(closePalette);
            setSettingsOpen((open) => !open);
        },
        /** The palette's other key switches what it looks for, its own key closes it. */
        togglePalette: (mode: PaletteMode) => {
            setSettingsOpen((open) => (open ? false : open));
            setPalette((current) => ({
                open: !(current.open && current.mode === mode),
                mode,
                text: '',
            }));
        },
        /** A file's find bar looks further, in all the project's files. */
        findInFiles: (text: string) => setPalette({ open: true, mode: 'contents', text }),
        toggleHelp: () => setHelpOpen((open) => !open),
    };
}
