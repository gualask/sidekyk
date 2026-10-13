import { IconGitCompare } from '@tabler/icons-react';
import { definePanel, type PanelTarget } from '@/shared/panels/panel';
import { fileKey } from './model/file-groups';
import type { ChangeArea } from './model/repository.types';

export const changesPanel = definePanel({
    id: 'changes',
    title: 'Changes',
    icon: IconGitCompare,
    load: () => import('./ui/ChangesWorkspace'),
    pick: (module) => module.ChangesWorkspace,
    summary: {
        load: () => import('./ui/ChangesSummary'),
        pick: (module) => module.ChangesSummary,
    },
});

/** Asks the Changes panel to show a changed file, in one area. */
export function changesTarget(file: { path: string; area: ChangeArea }): PanelTarget {
    return { key: fileKey(file) };
}
