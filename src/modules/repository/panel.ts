import { IconFolder, IconGitCompare } from '@tabler/icons-react';
import { definePanel } from '@/shared/panels/panel';
import { FILES_TREE_WIDTH } from './ui/tree-layout';

export const changesPanel = definePanel({
    id: 'changes',
    title: 'panel.changes',
    icon: IconGitCompare,
    needs: 'repository',
    load: () => import('./ui/ChangesWorkspace'),
    pick: (module) => module.ChangesWorkspace,
    summary: {
        load: () => import('./ui/ChangesSummary'),
        pick: (module) => module.ChangesSummary,
    },
});

export const filesPanel = definePanel({
    id: 'files',
    title: 'panel.files',
    icon: IconFolder,
    needs: 'folder',
    tileMinWidth: FILES_TREE_WIDTH.min,
    load: () => import('./ui/FilesWorkspace'),
    pick: (module) => module.FilesWorkspace,
    summary: {
        load: () => import('./ui/FilesSummary'),
        pick: (module) => module.FilesSummary,
    },
});
