import { createContext, createElement, type ReactNode, useContext } from 'react';
import type { ProjectList } from '../model/project.types';

/** The projects' runtime boundary: the native backend, or a fixture in browser dev mode. */
export interface ProjectsPort {
    getProjects(): Promise<ProjectList>;
    /** Asks for a folder, adds its repository and shows it. null when the user cancels. */
    addProject(): Promise<ProjectList | null>;
    activateProject(root: string): Promise<ProjectList>;
    /** Forgets a project; its repository is left as it is. */
    removeProject(root: string): Promise<ProjectList>;
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
