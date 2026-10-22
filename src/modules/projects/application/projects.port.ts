import { createContext, createElement, type ReactNode, useContext } from 'react';
import type { ProjectList, Relocation, TilesLayout } from '../model/project.types';

/** The projects' runtime boundary: the native backend, or a fixture in browser dev mode. */
export interface ProjectsPort {
    getProjects(): Promise<ProjectList>;
    /** Asks for a folder, adds its repository and shows it. null when the user cancels. */
    addProject(): Promise<ProjectList | null>;
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
    /** The list changed without the frontend asking. Returns a synchronous disposer. */
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
