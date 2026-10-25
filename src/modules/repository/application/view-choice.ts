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

/**
 * The element a preview's link named in the file it leads to (`file.md#install`), for that file
 * to open on, until another file shows.
 */
export function useLinkedAnchor(shown: string | null): {
    anchorFor: (path: string) => string | null;
    link: (path: string, anchor: string | null) => void;
} {
    const [linked, setLinked] = useState<{ file: string; anchor: string } | null>(null);
    // another file shows: the element named was in the one before
    if (linked && linked.file !== shown) setLinked(null);
    return {
        anchorFor: (path) => (linked?.file === path ? linked.anchor : null),
        link: (path, anchor) => setLinked(anchor === null ? null : { file: path, anchor }),
    };
}
