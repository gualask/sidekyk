import { createContext, createElement, type ReactNode, useContext } from 'react';
import type {
    FolderChange,
    FolderChoice,
    Opened,
    ProjectList,
    TilesLayout,
} from '../model/project.types';

/** The projects' runtime boundary: the native backend, or a fixture in browser dev mode. */
export interface ProjectsPort {
    getProjects(): Promise<ProjectList>;
    /**
     * What a folder given on the command line did, once (null when nothing): a project put on
     * screen, whose panels the app shows, or a folder above repositories to ask about.
     */
    takeOpened(): Promise<Opened | null>;
    /** Asks for a new project's folder and says what it is. null when the user cancels. */
    chooseProjectFolder(): Promise<FolderChoice | null>;
    /**
     * Adds a project of this name, following the folders at `folders` (paths as
     * `chooseProjectFolder` gave them; none, one or several), and shows it.
     */
    createProject(name: string, folders: string[]): Promise<ProjectList>;
    renameProject(projectId: string, name: string): Promise<ProjectList>;
    activateProject(projectId: string): Promise<ProjectList>;
    /** Forgets a project and deletes its notes; its repository is left as it is. */
    removeProject(projectId: string): Promise<ProjectList>;
    /**
     * Asks for the folder a moved folder of a project is in now, and the project follows it there,
     * the folder keeping its id; a folder that is another project's is not taken. null when the
     * user cancels.
     */
    relocateFolder(folderId: string): Promise<FolderChange | null>;
    /**
     * The folder the window shows (null for none), which the window chooses: it is watched while on
     * screen, and the palette looks in its files.
     */
    showProjectFolder(folderId: string | null): Promise<void>;
    /**
     * Asks for another folder of a project, which it follows after its own; a folder
     * that is another project's is not taken, that project coming back to merge. null when the
     * user cancels.
     */
    addProjectFolder(projectId: string): Promise<FolderChange | null>;
    /** Stops following one of a project's folders; the folder is left as it is. */
    removeProjectFolder(projectId: string, folderId: string): Promise<ProjectList>;
    /**
     * Merges the project `from` into `into`: its folders follow `into`'s, its lists of notes move
     * into it, and `from` goes.
     */
    mergeProjects(into: string, from: string): Promise<ProjectList>;
    /** Keeps how a project lays out its tiles. */
    setProjectLayout(projectId: string, layout: TilesLayout): Promise<ProjectList>;
    /**
     * The list changed without the frontend asking. `listener` also runs once as the listening
     * starts, for a change made before it. Returns a synchronous disposer.
     */
    onProjectsChanged(listener: () => void): () => void;
}

const ProjectsPortContext = createContext<ProjectsPort | null>(null);

export function ProjectsProvider({
    value,
    children,
}: {
    value: ProjectsPort;
    children: ReactNode;
}) {
    return createElement(ProjectsPortContext.Provider, { value }, children);
}

export function useProjectsPort(): ProjectsPort {
    const port = useContext(ProjectsPortContext);
    if (!port) {
        throw new Error('useProjectsPort must be used within ProjectsProvider');
    }
    return port;
}
