import { useMemo, useRef } from 'react';
import type { NoteReferences } from '@/modules/notes';
import { fileTarget, useFoldersHolding, useOpenUrl } from '@/modules/repository';
import { useFileSearch } from '@/modules/search';
import { useTranslation } from '@/shared/i18n';
import type { PanelTarget } from '@/shared/panels/panel';
import type { ProjectFolder, ProjectInfo } from '@/shared/projects/project-info';
import { errorToast, useShowToast } from '@/shared/ui/toasts';

/**
 * Where a note's references lead (`docs/features/note-references.md`): the files of the folder
 * on screen, whose Files panel shows them. A file opens in Files full screen at its lines; one the
 * folder does not have opens in the project's other folder that has it (asked which when several
 * do); one none has (moved, deleted) says so. Addresses open in the browser.
 */
export function useAppNoteReferences({
    project,
    folder,
    hasFiles,
    openInFiles,
}: {
    /** The project whose panels show, if any. */
    project: ProjectInfo | null;
    /** Its folder on screen. */
    folder: ProjectFolder | null;
    /** The folder has its Files panel: it reads without starting a WSL distro. */
    hasFiles: boolean;
    /**
     * Shows a file in Files full screen, its target given: in the folder on screen, or once
     * another folder of the project is on screen (`folderId`), or one of those `among`, asked.
     */
    openInFiles: (
        target: PanelTarget,
        folderId: string | null,
        among: readonly string[] | null,
    ) => void;
}): NoteReferences {
    const search = useFileSearch();
    const holding = useFoldersHolding();
    const openUrl = useOpenUrl();
    const showToast = useShowToast();
    const i18n = useTranslation();
    const projectId = project?.id ?? null;
    const shown = hasFiles ? (folder?.id ?? null) : null;
    // the app's latest, so that what the notes are given changes only with the folder on screen
    const open = useRef(openInFiles);
    open.current = openInFiles;
    // where the app is now: an answer for a click made elsewhere (another project or folder
    // shown meanwhile) is let go
    const onScreen = useRef({ projectId, shown });
    onScreen.current = { projectId, shown };

    return useMemo(() => {
        const files = shown
            ? {
                  folder: shown,
                  search: async (query: string) => {
                      const found = await search(shown, query);
                      // a file deleted, which Changes still lists, is no longer there to open
                      return found.files
                          .filter((file) => file.mark !== 'deleted')
                          .map(({ path, highlights }) => ({ path, highlights }));
                  },
              }
            : null;
        return {
            filesOf: (book) => (book === projectId ? files : null),
            openFile: (book, path, lines) => {
                if (book !== projectId) return;
                const target = fileTarget(path, null, null, lines);
                holding(book, shown, path)
                    .then((held) => {
                        const now = onScreen.current;
                        if (now.projectId !== projectId || now.shown !== shown) return;
                        if (held.length === 0) {
                            showToast({ title: i18n.t('notes.fileNotFound', { path }) });
                        } else if (shown !== null && held.includes(shown)) {
                            open.current(target, null, null);
                        } else if (held.length === 1) {
                            open.current(target, held[0] ?? null, null);
                        } else {
                            open.current(target, null, held);
                        }
                    })
                    .catch((error: unknown) =>
                        showToast(
                            errorToast(i18n.t('common.openFailed', { name: path }), error, i18n),
                        ),
                    );
            },
            openUrl,
        };
    }, [projectId, shown, search, holding, openUrl, showToast, i18n]);
}
