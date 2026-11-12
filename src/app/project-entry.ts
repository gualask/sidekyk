import { useState } from 'react';
import { flushSync } from 'react-dom';
import {
    type ProjectList,
    useActivateProject,
    useCurrentProjects,
    useFolderOnScreen,
} from '@/modules/projects';
import { folderOnScreen, type ProjectInfo } from '@/shared/projects/project-info';

/** A project of several folders being entered, until a folder is picked; then `then` goes on. */
interface Picking {
    projectId: string;
    then: () => void;
    /** The folders offered, by their ids; null for all. */
    among: readonly string[] | null;
}

/**
 * Which project and folder are on screen, and every way into a project
 * (`docs/features/project-folders.md`). The folder is the window's to choose, as its zoom level:
 * the one picked of each project for the session, else the project's only one, told to the
 * backend, which watches it. `enter` puts a project on screen, then does `then` (a zoom, a
 * target), on the folder given, else its only one; one of several asks which first (`picker`),
 * only among the folders given if any (those holding a file a note names),
 * and `Esc` there leaves everything as it was. `select` puts a project on screen without entering
 * it: the row selected at all projects. `enter` looks the project up in the list as it is now, so
 * a folder given at startup opens before the list's first render.
 */
export function useProjectEntry(list: ProjectList | undefined, project: ProjectInfo | null) {
    const [picked, setPicked] = useState<Readonly<Record<string, string>>>({});
    const folder = project ? folderOnScreen(project, picked) : null;
    useFolderOnScreen(folder?.id ?? null);
    const select = useActivateProject();
    const currentList = useCurrentProjects();
    const [picking, setPicking] = useState<Picking | null>(null);
    // the project being entered, whose row the zoom grows from while the list catches up
    const [entering, setEntering] = useState<string | null>(null);
    if (entering !== null && list?.active === entering) setEntering(null);

    const pick = (projectId: string, folderId: string) =>
        setPicked((current) => ({ ...current, [projectId]: folderId }));
    const enter = (
        projectId: string,
        then: () => void,
        folderId: string | null = null,
        among: readonly string[] | null = null,
    ) => {
        // the list as it is now: entered right after it changed, the render's has not the project
        const next = currentList()?.projects.find((p) => p.id === projectId);
        if (!next) return;
        if (folderId === null && (among !== null || next.folders.length > 1)) {
            setPicking({ projectId, then, among });
            return;
        }
        if (folderId !== null) pick(projectId, folderId);
        flushSync(() => setEntering(projectId));
        select(projectId);
        then();
    };
    const asked = picking ? askedProject(list, picking) : undefined;

    return {
        folder,
        /** Shows another folder of the project on screen, at the same zoom. */
        showFolder: (folderId: string) => {
            if (project) pick(project.id, folderId);
        },
        enter,
        select,
        /** The project whose row the zoom grows from, and back into. */
        zoomed: entering ?? list?.active ?? null,
        /** The folder of a project of several asked for, while it is. */
        picker:
            picking && asked
                ? {
                      project: asked,
                      pick: (folderId: string) => {
                          setPicking(null);
                          enter(asked.id, picking.then, folderId);
                      },
                      close: () => setPicking(null),
                  }
                : null,
    };
}

/**
 * The project asked about as the list has it now, which its folders may have changed, with the
 * folders offered; none once it is gone.
 */
function askedProject(list: ProjectList | undefined, picking: Picking): ProjectInfo | undefined {
    const found = list?.projects.find((p) => p.id === picking.projectId);
    const among = picking.among;
    return found && among
        ? { ...found, folders: found.folders.filter((f) => among.includes(f.id)) }
        : found;
}
