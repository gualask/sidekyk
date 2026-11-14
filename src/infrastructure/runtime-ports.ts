import type { NotesPort } from '@/modules/notes';
import type { ProjectsPort } from '@/modules/projects';
import type { RepositoryPort } from '@/modules/repository';
import type { SearchPort } from '@/modules/search';
import type { SettingsPort } from '@/modules/settings';
import type { CompactWindowPort } from '@/shared/platform/compact-window';
import type { TitleBarPort } from '@/shared/platform/title-bar';

/**
 * All runtime boundaries composed by the app shell. Each field remains a focused port. Two
 * implementations: `tauri/` (the backend) and `fixtures/` (in memory, for the browser).
 */
export type RuntimePorts = {
    notes: NotesPort;
    projects: ProjectsPort;
    repository: RepositoryPort;
    search: SearchPort;
    settings: SettingsPort;
    titleBar: TitleBarPort;
    compactWindow: CompactWindowPort;
    /** Records an uncaught frontend error where problems are investigated (the app's log). */
    reportError: (message: string) => void;
    /** Shows the window, created hidden so that startup shows no blank frame. */
    showWindow: () => void;
};
