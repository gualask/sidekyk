import type { RuntimePorts } from '@/infrastructure/runtime-ports';
import { tauriCompactWindow } from './compact-window';
import { reportFrontendError } from './diagnostics';
import { tauriNotes } from './notes';
import { tauriProjects } from './projects';
import { tauriRepository } from './repository';
import { tauriSearch } from './search';
import { tauriSettings } from './settings';
import { tauriTitleBar } from './title-bar';
import { showWindow } from './window';

export const tauriRuntimePorts: RuntimePorts = {
    notes: tauriNotes,
    projects: tauriProjects,
    repository: tauriRepository,
    search: tauriSearch,
    settings: tauriSettings,
    titleBar: tauriTitleBar,
    compactWindow: tauriCompactWindow,
    reportError: reportFrontendError,
    showWindow,
};
