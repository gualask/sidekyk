import { IconCopyMinus, IconFileText } from '@tabler/icons-react';
import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { errorMessage } from '@/shared/errors/app-error';
import { CHANGE_AREA_LABEL } from '@/shared/git/change-area';
import type { PanelProps } from '@/shared/panels/panel';
import { useWindowKeys } from '@/shared/ui/hooks/use-window-keys';
import { isOwnKey } from '@/shared/ui/keys';
import { SidebarSplitter } from '@/shared/ui/SidebarSplitter';
import { useSessionState } from '@/shared/ui/session-state';
import { useSidebarWidth } from '@/shared/ui/sidebar-width';
import { useFileFind } from '../application/find';
import { useTreeDirectories } from '../application/repository.queries';
import { useSelectedFile } from '../application/selection';
import { useShownTarget } from '../application/shown-target';
import { changeMarks, foldersAbove, treeMove, treeRows } from '../model/file-tree';
import { selectionOf } from '../model/selection';
import { fileTarget } from '../model/targets';
import { ChangeDiffView } from './DiffView';
import { FileHeader } from './FileHeader';
import { FileTree } from './FileTree';
import { TextFileView } from './TextFileView';
import { FILES_TREE_WIDTH, fittingWidth } from './tree-layout';

/** The tree of a project, kept for the session. */
interface TreeState {
    /** The folders open, by path. A folder closed above keeps its own open. */
    open: ReadonlySet<string>;
    /** The row the keyboard is on: the file shown, or a folder moved to. */
    selected: string | null;
}

const CLOSED: TreeState = { open: new Set(), selected: null };

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
 * The Files panel: the project's files as a tree. The file shown is the one of Changes (one
 * selection for both): the tree reveals it, and a file picked in the tree shows there. In a tile
 * Files is the tree alone, Changes being the viewer; full screen the file shows next to the tree,
 * a changed one whole with its changes marked, any other as its text. No filter here: the command
 * palette finds files, and shows them in the tree.
 */
export function FilesWorkspace({
    project,
    header,
    tileFit,
    target,
    place,
    selected: hasKeys,
    show,
    findInFiles,
}: PanelProps) {
    const projectId = project.id;
    const [state, setState] = useSessionState<TreeState>(`tree:${projectId}`, CLOSED);
    const { open, selected } = state;
    // the file shown, one for both panels: Changes selects it in its list
    const { snapshot, files, setSelection, change, path: file } = useSelectedFile(projectId);
    const find = useFileFind(projectId, change?.path ?? file, findInFiles);
    // the hunk a file asked for from Changes opens on, until another file shows
    const [openOn, setOpenOn] = useState<{ file: string; hunk: number } | null>(null);
    const marks = useMemo(() => changeMarks(files), [files]);
    const { read, error } = useTreeDirectories(projectId, open);
    const rows = useMemo(() => treeRows(open, read), [open, read]);
    const truncated = read('')?.truncated ?? false;

    // the file shown, wherever it was picked, is revealed: the folders above it open
    const reveal = useEffectEvent((path: string) => {
        setState((current) => ({
            open: new Set([...current.open, ...foldersAbove(path)]),
            selected: path,
        }));
    });
    useEffect(() => {
        if (file) reveal(file);
    }, [file]);

    const openFile = (path: string, hunk: number | null = null) => {
        setSelection((current) => selectionOf(path, current));
        setOpenOn(hunk === null ? null : { file: path, hunk });
    };
    const toggle = (path: string) => {
        setState((current) => {
            const next = new Set(current.open);
            if (!next.delete(path)) next.add(path);
            return { ...current, open: next, selected: path };
        });
    };

    // a file asked for from Changes, at the hunk being read there; revealed again even when it is
    // the file shown already, as the keyboard may have left it
    useShownTarget(target, (shown) => {
        openFile(shown.path, shown.hunk);
        reveal(shown.path);
        if (shown.find) find.open(shown.path, shown.find);
    });

    // before the workspace's keys, so `↵` opens what is selected instead of zooming; in a tile a
    // file moved to shows at once, as in Changes' list
    useWindowKeys(
        (event) => {
            const ours = place === 'full' ? FULL_KEYS : TILE_KEYS;
            if (!hasKeys || !ours.has(event.key) || event.defaultPrevented) return;
            if (!isOwnKey(event)) return;
            const move = treeMove(rows, selected, event.key);
            if (!move) return;
            event.preventDefault();
            if (move.kind === 'toggle') toggle(move.path);
            else if (move.kind === 'open' || (place === 'tile' && !move.folder)) {
                openFile(move.path);
            } else setState((current) => ({ ...current, selected: move.path }));
        },
        { capture: true },
    );

    const treeWidth = useSidebarWidth('files', FILES_TREE_WIDTH);
    const treeBox = useRef<HTMLDivElement>(null);
    // as VS Code's "Collapse Folders in Explorer"; the file shown is revealed again once another
    // is picked
    const collapse = header
        ? createPortal(
              <>
                  {/* in a tile the button sits on the right, by the zoom, as Changes' actions do */}
                  {place === 'tile' ? <span className="flex-1" /> : null}
                  <button
                      type="button"
                      className="btn-icon h-[26px] w-[26px]"
                      title="Collapse folders"
                      aria-label="Collapse folders"
                      disabled={open.size === 0}
                      onClick={() => setState((current) => ({ ...current, open: new Set() }))}
                  >
                      <IconCopyMinus size={14} />
                  </button>
              </>,
              header,
          )
        : null;
    const tree = (
        <div className="flex h-full flex-col">
            {error ? (
                <div className="px-3 py-2 font-sans text-sm text-ui-danger">
                    {errorMessage(error)}
                </div>
            ) : null}
            <div className="min-h-0 flex-1">
                <FileTree
                    rows={rows}
                    marks={marks}
                    selected={selected}
                    label={`Files of ${project.name}`}
                    onClick={(row) => {
                        if (row.kind === 'folder') toggle(row.path);
                        else openFile(row.path);
                    }}
                />
            </div>
        </div>
    );
    const tooMany = truncated ? (
        <div className="border-b border-ui-border bg-ui-warning-soft px-3 py-2 text-sm text-ui-warning-soft-text">
            Too many files: only the first 200,000 are in the tree. A folder such as node_modules
            may be missing from .gitignore.
        </div>
    ) : null;

    // in a tile, the tile's splitter fits the tree, as the tree's own does full screen
    useEffect(() => {
        if (!tileFit) return;
        tileFit(() => (treeBox.current ? fittingWidth(rows, treeBox.current) : 0));
        return () => tileFit(null);
    }, [tileFit, rows]);

    // the tree's edge, by the file viewer full screen
    const splitter = (
        <SidebarSplitter
            width={treeWidth}
            box={treeBox}
            place="edge"
            fitting={(box) => fittingWidth(rows, box)}
            what="tree"
        />
    );

    if (place === 'tile') {
        // in a tile the tree fills it; the app sets its width, the tree's (one setting)
        return (
            <div
                ref={treeBox}
                className="flex h-full w-full flex-col bg-ui-surface font-mono text-[12.5px]"
            >
                {collapse}
                {tooMany}
                <div className="min-h-0 flex-1">{tree}</div>
            </div>
        );
    }

    // the change shown, a deleted file too though the tree does not have it; else the file
    const viewer = change ? (
        <ChangeDiffView
            key={`${change.area}:${change.path}`}
            projectId={projectId}
            file={change}
            view="file"
            openOn={openOn?.file === change.path ? openOn.hunk : null}
            header={header}
            finder={find.finderFor(change.path)}
            renderHeader={(pane) => (
                <FileHeader
                    path={change.path}
                    uncolored={pane.uncolored}
                    badge={{ label: CHANGE_AREA_LABEL[change.area] }}
                    counts={change}
                    showIn={{
                        panel: 'changes',
                        onShow: () => show('changes', fileTarget(change.path, pane.currentHunk())),
                    }}
                />
            )}
        />
    ) : !file ? (
        <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-ui-text-muted">
            <IconFileText size={32} stroke={1.5} />
            <p className="text-sm">Pick a file.</p>
            <p className="text-xs">Read only: edits happen in your editor.</p>
        </div>
    ) : !snapshot.isSuccess ? null : (
        <TextFileView
            key={file}
            projectId={projectId}
            path={file}
            header={header}
            finder={find.finderFor(file)}
            renderHeader={(pane) => <FileHeader path={file} uncolored={pane.uncolored} />}
        />
    );

    return (
        <div className="flex h-full flex-col">
            {collapse}
            {tooMany}
            <div className="flex min-h-0 flex-1">
                <div
                    ref={treeBox}
                    className="shrink-0 border-r border-ui-border bg-ui-surface font-mono text-[12.5px]"
                    style={treeWidth.style}
                >
                    {tree}
                </div>
                {splitter}
                <main className="min-w-0 flex-1 bg-ui-surface-subtle">{viewer}</main>
            </div>
        </div>
    );
}
