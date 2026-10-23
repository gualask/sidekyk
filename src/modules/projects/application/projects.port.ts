import { createContext, createElement, type ReactNode, useContext } from 'react';
import type { FolderChoice, ProjectList, Relocation, TilesLayout } from '../model/project.types';

/** The projects' runtime boundary: the native backend, or a fixture in browser dev mode. */
export interface ProjectsPort {
    getProjects(): Promise<ProjectList>;
    /**
     * The project a folder given on the command line put on screen, once (null when none): the
     * app shows its panels.
     */
    takeOpenedProject(): Promise<string | null>;
    /** Asks for a new project's folder and says what it is. null when the user cancels. */
    chooseProjectFolder(): Promise<FolderChoice | null>;
    /**
     * Adds a project of this name, following the repository at `folder` (a path as
     * `chooseProjectFolder` gave it) or none, and shows it.
     */
    createProject(name: string, folder: string | null): Promise<ProjectList>;
    renameProject(projectId: string, name: string): Promise<ProjectList>;
    activateProject(projectId: string): Promise<ProjectList>;
    /** Forgets a project and deletes its notes; its repository is left as it is. */
    removeProject(projectId: string): Promise<ProjectList>;
    /**
     * Asks for the folder a moved repository is in now, and the project follows it there; a
     * folder that is another project's is not taken. null when the user cancels.
     */
    relocateProject(projectId: string): Promise<Relocation | null>;
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
