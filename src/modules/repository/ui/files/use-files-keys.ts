import type { PanelProps } from '@/shared/panels/panel';
import { useWindowKeys } from '@/shared/ui/hooks/use-window-keys';
import { isOwnKey } from '@/shared/ui/keys';
import { leftToTiles } from '../../model/keys';
import { treeMove } from '../../model/tree/file-tree';
import { recentMove } from '../../model/tree/recent-files';
import type { FilesView } from './FilesActions';
import type { RecentListState } from './recent/use-recent-list';
import type { FileTreeState } from './tree/use-file-tree';

/**
 * The keys of Files while its panel is selected (`active`), on the view shown: those its tree or
 * Recent takes (`treeMove`, `recentMove`), but in a tile those it leaves to the workspace
 * (`leftToTiles`). Before the workspace's keys, so `↵` opens what is selected instead of zooming;
 * in a tile a file moved to becomes the one shown (`openFile`), as in Changes' list: there at
 * once, without git once `↵` zooms in.
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
    // a key moves in the view shown: true when it did, and the key is taken
    const moveInRecent = (key: string): boolean => {
        const move = recentMove(recent.listed.rows, recent.selected, key);
        if (!move) return false;
        if (move.kind === 'open') pick(move.path);
        else if (place === 'tile') openFile(move.path);
        else recent.select(move.path);
        return true;
    };
    const moveInTree = (key: string): boolean => {
        const move = treeMove(tree.rows, tree.selected, key);
        if (!move) return false;
        if (move.kind === 'toggle') tree.toggle(move.path);
        else if (move.kind === 'open') pick(move.path);
        else if (place === 'tile' && !move.folder) openFile(move.path);
        else tree.select(move.path);
        return true;
    };
    useWindowKeys(
        (event) => {
            if (!active || event.defaultPrevented) return;
            if (place === 'tile' && leftToTiles(event.key)) return;
            if (!isOwnKey(event)) return;
            const moved = view === 'recent' ? moveInRecent(event.key) : moveInTree(event.key);
            if (moved) event.preventDefault();
        },
        { capture: true },
    );
}
