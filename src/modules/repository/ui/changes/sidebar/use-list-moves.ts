import { useTranslation } from '@/shared/i18n';
import type { PanelProps } from '@/shared/panels/panel';
import { useWindowKeys } from '@/shared/ui/hooks/use-window-keys';
import { isOwnKey } from '@/shared/ui/keys';
import { useShowToast } from '@/shared/ui/toasts';
import type { useCommitView } from '../../../application/commit-view';
import type { ChangedFile } from '../../../model/repository.types';
import type { Selection } from '../../../model/selection';
import { fileKey } from '../../../model/tree/file-groups';
import { commitFileKey } from '../shown-key';

const NEXT_KEYS = new Set(['ArrowDown', 'j']);
const PREVIOUS_KEYS = new Set(['ArrowUp', 'k']);
/** In a tile the arrows move among tiles: the list takes `j`/`k` only. */
const ARROWS = new Set(['ArrowDown', 'ArrowUp']);

/** A file of the list on screen: the key it shows under, and its opening. */
interface ListFile {
    key: string;
    open: () => void;
}

/**
 * The moves among the files of the list on screen, the commit's or the working tree's: the arrows
 * go to the next or previous one; `Esc` leaves the commit, or the file opened from Files; and the
 * step it returns, for `n`/`p` past a file's last or first change, opens the next or previous
 * file on its first change or its last, a word saying so at either end of the list.
 */
export function useListMoves({
    hasKeys,
    place,
    commitView,
    files,
    selectedIndex,
    selection,
    setSelection,
    unchanged,
    openAt,
}: {
    /** The panel takes the keys (`PanelProps['selected']`). */
    hasKeys: boolean;
    place: PanelProps['place'];
    commitView: ReturnType<typeof useCommitView>;
    files: readonly ChangedFile[];
    selectedIndex: number;
    selection: Selection;
    setSelection: (next: Selection) => void;
    /** The file of the tree shown, that did not change. */
    unchanged: string | null;
    openAt: (file: string, hunk: number) => void;
}): (step: 1 | -1) => void {
    const i18n = useTranslation();
    const viewed = commitView.commit;
    const neighbour = (step: number): ListFile | null => {
        if (viewed) {
            const next = commitView.neighbour(step);
            if (!next) return null;
            return { key: commitFileKey(viewed.sha, next.path), open: () => commitView.open(next) };
        }
        const next = files[selectedIndex + step];
        if (!next) return null;
        const key = fileKey(next);
        return { key, open: () => setSelection({ kind: 'change', key }) };
    };

    // the arrows move in the list on screen
    useWindowKeys((event) => {
        if (!hasKeys || (place === 'tile' && ARROWS.has(event.key)) || !isOwnKey(event)) return;
        const step = NEXT_KEYS.has(event.key) ? 1 : PREVIOUS_KEYS.has(event.key) ? -1 : 0;
        if (step === 0) return;
        const next = neighbour(step);
        if (!next) return;
        event.preventDefault();
        next.open();
    });

    // `Esc` is progressive: it leaves the commit, or the file opened from Files, before it zooms
    // out, so it comes before the workspace's keys
    useWindowKeys(
        (event) => {
            if (!hasKeys || event.key !== 'Escape' || (!viewed && unchanged === null)) return;
            if (event.defaultPrevented || !isOwnKey(event)) return;
            event.preventDefault();
            if (viewed) commitView.leave();
            else if (selection.kind === 'path') {
                setSelection({ kind: 'change', key: selection.back });
            }
        },
        { capture: true },
    );

    // `n`/`p` past a file's last or first change: the next or previous file of the list, on its
    // first change or its last; at either end of the list, a word says so
    const showToast = useShowToast();
    return (step) => {
        const next = neighbour(step);
        if (!next) {
            showToast({ title: i18n.t(step > 0 ? 'changes.last' : 'changes.first') });
            return;
        }
        next.open();
        openAt(next.key, step > 0 ? 0 : -1);
    };
}
