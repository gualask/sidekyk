import type { RuntimePorts } from '@/infrastructure/runtime-ports';
import { fixtureNotes } from './notes';
import { fixtureProjectList, fixtureProjectsPort } from './projects';
import { fixtureRepository } from './repository';
import type { Scenario } from './scenario';
import { fixtureSearchPort } from './search';
import { fixtureSettings } from './settings';
import { fixtureWindow } from './window';

/** The fixtures' runtime: the ports, and what stands in for the command line. */
export interface BrowserRuntime {
    ports: RuntimePorts;
    /**
     * As `sidekyk <folder>` (`open_folder`): the project of that name, else one added for a folder
     * of that name; on screen, and the frontend told the list changed.
     */
    openFolder: (name: string) => void;
    /** As `git init` in the folder of the project of that name, its watcher telling the change. */
    gitInit: (name: string) => void;
    /** As its `.git` removed. */
    gitRemove: (name: string) => void;
    /** As `wsl --shutdown` of the distro of the project of that name: started again by a read. */
    stopDistro: (name: string) => void;
    /**
     * As an agent writing a file of the project of that name, its watcher telling the change:
     * `text`, or the fixtures' later version of it (`fixture-files/edits/`), whose preview is
     * the backend's.
     */
    writeFile: (name: string, path: string, text?: string) => void;
    /** As the quick note's global shortcut: opens it, or closes it when open, as `Esc`. */
    quickNote: () => void;
}

/** Browser-safe ports for `?dev=…` fixtures: fixed data, no native backend. */
export function createBrowserRuntime(scenario: Scenario): BrowserRuntime {
    const projects = fixtureProjectList(scenario);
    const shownWindow = fixtureWindow();
    const notes = fixtureNotes(scenario, projects, shownWindow.openCapture);
    const projectsPort = fixtureProjectsPort(projects, notes);
    const repository = fixtureRepository(scenario, projects);
    return {
        ports: {
            notes,
            projects: projectsPort.port,
            repository: repository.port,
            search: fixtureSearchPort(projects, repository.folders, notes),
            settings: fixtureSettings(scenario),
            ...shownWindow.ports,
        },
        openFolder: projectsPort.openFolder,
        gitInit: (name) => repository.setKind(name, 'repository'),
        gitRemove: (name) => repository.setKind(name, 'plain'),
        stopDistro: repository.stopDistro,
        writeFile: repository.writeFile,
        quickNote: shownWindow.toggleQuickNote,
    };
}
