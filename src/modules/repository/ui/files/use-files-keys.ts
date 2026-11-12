import type { PanelProps } from '@/shared/panels/panel';
import { useWindowKeys } from '@/shared/ui/hooks/use-window-keys';
import { isOwnKey } from '@/shared/ui/keys';
import { treeMove } from '../../model/tree/file-tree';
import { recentMove } from '../../model/tree/recent-files';
import type { FilesView } from './FilesActions';
import type { RecentListState } from './recent/use-recent-list';
import type { FileTreeState } from './tree/use-file-tree';

/**
 * The keys the tree takes: in a tile `j`/`k` and `Space`, the arrows moving among tiles and `↵`
 * zooming; full screen the arrows and `↵` too.
 */
const TILE_KEYS = new Set(['j', 'k', ' ']);
const FULL_KEYS = new Set([
    ...TILE_KEYS,
    'ArrowUp',
    'ArrowDown',
    'ArrowLeft',
    'ArrowRight',
    'Enter',
]);

/**
 * The keys of Files while its panel is selected (`active`), on the view shown. Before the
 * workspace's keys, so `↵` opens what is selected instead of zooming; in a tile a file moved to
 * becomes the one shown (`openFile`), as in Changes' list: there at once, without git once `↵`
 * zooms in.
 */
export function useFilesKeys({
    active,
    place,
    view,
    tree,
    recent,
    pick,
    openFile,
}: {
    active: boolean;
    place: PanelProps['place'];
    view: FilesView;
    tree: FileTreeState;
    recent: RecentListState;
    /** Opens a file as `↵` does. */
    pick: (path: string) => void;
    openFile: (path: string) => void;
}) {
    useWindowKeys(
        (event) => {
            const ours = place === 'full' ? FULL_KEYS : TILE_KEYS;
            if (!active || !ours.has(event.key) || event.defaultPrevented) return;
            if (!isOwnKey(event)) return;
            if (view === 'recent') {
                const move = recentMove(recent.listed.rows, recent.selected, event.key);
                if (!move) return;
                event.preventDefault();
                if (move.kind === 'open') pick(move.path);
                else if (place === 'tile') openFile(move.path);
                else recent.select(move.path);
                return;
            }
            const move = treeMove(tree.rows, tree.selected, event.key);
            if (!move) return;
            event.preventDefault();
            if (move.kind === 'toggle') tree.toggle(move.path);
            else if (move.kind === 'open') pick(move.path);
            else if (place === 'tile' && !move.folder) openFile(move.path);
            else tree.select(move.path);
        },
        { capture: true },
    );
}
