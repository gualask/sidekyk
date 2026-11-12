import { Suspense } from 'react';
import { useForgetBooks } from '@/modules/notes';
import { useRemoveProject } from '@/modules/projects';
import { Preloaded } from '@/shared/ui/Preloaded';
import type { useProjectEntry } from '../project-entry';
import {
    CommandPalette,
    EditProjectDialog,
    FolderPicker,
    RemoveProjectDialog,
    SettingsDialog,
    ShortcutsHelp,
} from './dialog-chunks';
import type { Dialogs } from './dialogs';
import type { PaletteContent } from './palette-content';

/**
 * The dialogs over the workspace, each loaded on its first show: a project's to remove or to
 * edit, the folder to enter a project on, the shortcuts, the settings and the command palette.
 */
export function ShellDialogs({
    dialogs,
    picker,
    palette,
}: {
    dialogs: Dialogs;
    /** The folder of a project of several asked for, while it is. */
    picker: ReturnType<typeof useProjectEntry>['picker'];
    palette: PaletteContent;
}) {
    const { mutate: removeProject } = useRemoveProject();
    const forgetBooks = useForgetBooks();
    const { removing, editing, helpOpen, settingsOpen } = dialogs;
    return (
        <>
            {removing ? (
                <Suspense fallback={null}>
                    <Preloaded
                        key={removing.id}
                        of={RemoveProjectDialog}
                        props={{
                            project: removing,
                            onRemove: () => removeProject(removing.id),
                            onClose: () => dialogs.setRemoving(null),
                        }}
                    />
                </Suspense>
            ) : null}
            {picker ? (
                <Suspense fallback={null}>
                    <Preloaded
                        key={picker.project.id}
                        of={FolderPicker}
                        props={{
                            project: picker.project,
                            onPick: picker.pick,
                            onClose: picker.close,
                        }}
                    />
                </Suspense>
            ) : null}
            {editing ? (
                <Suspense fallback={null}>
                    <Preloaded
                        key={editing.id}
                        of={EditProjectDialog}
                        props={{
                            project: editing,
                            onMerged: (into: string, from: string) => forgetBooks([into, from]),
                            onClose: () => dialogs.setEditing(null),
                        }}
                    />
                </Suspense>
            ) : null}
            {helpOpen ? (
                <Suspense fallback={null}>
                    <ShortcutsHelp onClose={() => dialogs.setHelpOpen(false)} />
                </Suspense>
            ) : null}
            {settingsOpen === null ? null : (
                <Suspense fallback={null}>
                    <Preloaded
                        of={SettingsDialog}
                        props={{ open: settingsOpen, onOpenChange: dialogs.setSettingsOpen }}
                    />
                </Suspense>
            )}
            {dialogs.palette.open === null ? null : (
                <Suspense fallback={null}>
                    <Preloaded
                        of={CommandPalette}
                        props={{
                            ...palette,
                            open: dialogs.palette.open,
                            onOpenChange: (open) =>
                                dialogs.setPalette((current) => ({ ...current, open })),
                            mode: dialogs.palette.mode,
                            onModeChange: (mode) =>
                                dialogs.setPalette((current) => ({ ...current, mode })),
                            initialText: dialogs.palette.text,
                        }}
                    />
                </Suspense>
            )}
        </>
    );
}
