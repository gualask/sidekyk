import type { NotesPort } from '@/modules/notes';
import type { ProjectsPort } from '@/modules/projects';
import type { RepositoryPort } from '@/modules/repository';
import type { SearchPort } from '@/modules/search';
import type { SettingsPort } from '@/modules/settings';
import type { TitleBarPort } from '@/shared/platform/title-bar';
import { reportFrontendError } from './tauri-diagnostics';
import { tauriNotes } from './tauri-notes';
import { tauriProjects } from './tauri-projects';
import { tauriRepository } from './tauri-repository';
import { tauriSearch } from './tauri-search';
import { tauriSettings } from './tauri-settings';
import { tauriTitleBar } from './tauri-title-bar';
import { showWindow } from './tauri-window';

/** All runtime boundaries composed by the app shell. Each field remains a focused port. */
export type RuntimePorts = {
    notes: NotesPort;
    projects: ProjectsPort;
    repository: RepositoryPort;
    search: SearchPort;
    settings: SettingsPort;
    titleBar: TitleBarPort;
    /** Records an uncaught frontend error where problems are investigated (the app's log). */
    reportError: (message: string) => void;
    /** Shows the window, created hidden so that startup shows no blank frame. */
    showWindow: () => void;
};

export const tauriRuntimePorts: RuntimePorts = {
    notes: tauriNotes,
    projects: tauriProjects,
    repository: tauriRepository,
    search: tauriSearch,
    settings: tauriSettings,
    titleBar: tauriTitleBar,
    reportError: reportFrontendError,
    showWindow,
};
