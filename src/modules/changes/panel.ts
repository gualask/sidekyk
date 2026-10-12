import { IconGitCompare } from '@tabler/icons-react';
import { definePanel } from '@/shared/panels/panel';

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
