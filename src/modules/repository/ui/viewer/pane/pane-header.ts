import { type RefObject, useMemo } from 'react';
import { useTranslation } from '@/shared/i18n';
import { type CopyState, useCopyToClipboard } from '@/shared/ui/hooks/use-copy-to-clipboard';
import type { FileFinder } from '../../../application/find';
import { useRepositorySettings } from '../../../application/repository-settings';
import { type CopySource, fileText } from '../../../model/diff/copied';
import type { DiffHunk } from '../../../model/diff/diff-parser';
import type { DiffRow } from '../../../model/diff/diff-rows';
import { type DiffLayout, FIND_BAR_SPACE, rowAt } from '../diff/diff-layout';
import type { HunkReader } from '../diff/diff-list/use-hunk-reader';

/** What a pane gives the header of the panel it is in. */
export interface PaneHeader {
    /** The copy of the whole diff, hunk by hunk; null while there are no hunks to copy. */
    copyFile: (() => void) | null;
    fileCopied: CopyState;
    /** The hunk being read, for the other view, or the other panel, to open on. */
    currentHunk: () => number;
    /** The file is too large to color: shown in the text's color alone. */
    uncolored: boolean;
    /** The line of the file at the top of the viewer, for its preview to open on. */
    topLine: () => number | null;
}

/** What a pane gives its panel's header, from its rows and where they are scrolled to. */
export function usePaneHeader({
    source,
    rows,
    hunks,
    layout,
    scrollElement,
    reader,
    uncolored,
    findBar,
}: {
    source: CopySource;
    rows: readonly DiffRow[];
    hunks: readonly DiffHunk[];
    layout: DiffLayout;
    scrollElement: HTMLDivElement | null;
    reader: RefObject<HunkReader | null>;
    uncolored: boolean;
    /** The find bar, over the rows while it shows. */
    findBar: FileFinder['bar'];
}): PaneHeader {
    const { copyTemplate } = useRepositorySettings();
    const { copied, copy } = useCopyToClipboard();
    const i18n = useTranslation();
    return useMemo<PaneHeader>(
        () => ({
            copyFile:
                hunks.length > 0
                    ? () => void copy('file', fileText(copyTemplate, source, hunks, i18n))
                    : null,
            fileCopied: copied?.id === 'file' ? copied : null,
            currentHunk: () => reader.current?.current() ?? 0,
            uncolored,
            topLine: () => {
                if (!scrollElement) return null;
                // the rows start below the find bar's room, when it shows
                const room = findBar ? FIND_BAR_SPACE : 0;
                const index = rowAt(layout, Math.max(0, scrollElement.scrollTop - room));
                const row = rows[index];
                return row?.kind === 'line' ? row.line.newNumber : null;
            },
        }),
        [
            hunks,
            copy,
            copyTemplate,
            source,
            copied,
            uncolored,
            i18n,
            scrollElement,
            layout,
            rows,
            findBar,
            reader,
        ],
    );
}
