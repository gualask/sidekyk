import { IconGitCompare } from '@tabler/icons-react';
import { definePanel } from '@/shared/panels/panel';

export const changesPanel = definePanel({
    id: 'changes',
    title: 'Changes',
    icon: IconGitCompare,
    load: () => import('./ui/ChangesWorkflow'),
    pick: (module) => module.ChangesWorkflow,
});
