import { useState } from 'react';
import type { FileView } from '@/shared/git/file-view';
import { useRepositorySettings } from './repository-settings';

/**
 * How a file with a preview shows in a panel: as the settings say, until the header's switch
 * chooses; the choice holds for the panel's files while the setting stays, as a diff's view does.
 */
export function useFileViewChoice(): { view: FileView; choose: (view: FileView) => void } {
    const setting = useRepositorySettings().fileView;
    const [chosen, setChosen] = useState<{ view: FileView; over: FileView } | null>(null);
    return {
        view: chosen?.over === setting ? chosen.view : setting,
        choose: (view) => setChosen({ view, over: setting }),
    };
}
