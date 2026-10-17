import { IconCopyMinus, IconFileText } from '@tabler/icons-react';
import { type PointerEvent, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { errorMessage } from '@/shared/errors/app-error';
import { CHANGE_AREA_LABEL } from '@/shared/git/change-area';
import type { PanelProps } from '@/shared/panels/panel';
import { useWindowKeys } from '@/shared/ui/hooks/use-window-keys';
import { isOwnKey } from '@/shared/ui/keys';
import { useTreeDirectories } from '../application/repository.queries';
import { useRepositorySettings } from '../application/repository-settings';
import { useSelectedFile } from '../application/selection';
import { useSessionState } from '../application/session-state';
import { useShownTarget } from '../application/shown-target';
import { changeMarks, foldersAbove, treeMove, treeRows } from '../model/file-tree';
import { selectionOf } from '../model/selection';
import { fileTarget } from '../model/targets';
import { ChangeDiffView } from './DiffView';
import { FileHeader } from './FileHeader';
import { FileTree } from './FileTree';
import { TextFileView } from './TextFileView';
import { fittingWidth } from './tree-layout';

/** The tree of a project, kept for the session. */
interface TreeState {
    /** The folders open, by path. A folder closed above keeps its own open. */
    open: ReadonlySet<string>;
    /** The row the keyboard is on: the file shown, or a folder moved to. */
    selected: string | null;
}

const CLOSED: TreeState = { open: new Set(), selected: null };

/** The tree's width by default, the same in a tile and full screen, and the least it takes. */
const TREE_WIDTH = 280;
const TREE_MIN_WIDTH = 160;
/** The file view keeps at least this much: the tree never takes it. */
const VIEWER_MIN_WIDTH = 240;

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
    target,
    place,
    selected: hasKeys,
    show,
}: PanelProps) {
    const root = project.root;
    const [state, setState] = useSessionState<TreeState>(`tree:${root}`, CLOSED);
    const { open, selected } = state;
    // the file shown, one for both panels: Changes selects it in its list
    const { snapshot, files, setSelection, change, path: file } = useSelectedFile(root);
    // the hunk a file asked for from Changes opens on, until another file shows
    const [openOn, setOpenOn] = useState<{ file: string; hunk: number } | null>(null);
    const marks = useMemo(() => changeMarks(files), [files]);
    const { read, error } = useTreeDirectories(root, open);
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
        setSelection((current) => selectionOf({ kind: 'path', path, hunk }, current));
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
        if (shown.kind !== 'path') return;
        openFile(shown.path, shown.hunk);
        reveal(shown.path);
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

    const width = useTreeWidth();
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

    if (place === 'tile') {
        return (
            <div
                className="flex h-full flex-col bg-ui-surface font-mono text-[12.5px]"
                style={{ width: width.value }}
            >
                {collapse}
                {tooMany}
                <div className="min-h-0 flex-1">{tree}</div>
            </div>
        );
    }

    const viewer = !file ? (
        <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-ui-text-muted">
            <IconFileText size={32} stroke={1.5} />
            <p className="text-sm">Pick a file.</p>
            <p className="text-xs">Read only: edits happen in your editor.</p>
        </div>
    ) : change ? (
        <ChangeDiffView
            key={`${change.area}:${file}`}
            root={root}
            file={change}
            view="file"
            openOn={openOn?.file === file ? openOn.hunk : null}
            header={header}
            renderHeader={(pane) => (
                <FileHeader
                    path={file}
                    badge={{ label: CHANGE_AREA_LABEL[change.area] }}
                    counts={change}
                    showIn={{
                        panel: 'changes',
                        onShow: () => show('changes', fileTarget(file, pane.currentHunk())),
                    }}
                />
            )}
        />
    ) : !snapshot.isSuccess ? null : (
        <TextFileView
            key={file}
            root={root}
            path={file}
            header={header}
            renderHeader={() => <FileHeader path={file} />}
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
                    style={{
                        width: width.value,
                        maxWidth: `calc(100% - ${VIEWER_MIN_WIDTH}px)`,
                    }}
                >
                    {tree}
                </div>
                <div
                    aria-hidden
                    title="Drag to resize; double click to fit the whole tree, again to go back"
                    className="group relative z-[2] -ml-1 w-2 shrink-0 cursor-col-resize"
                    onPointerDown={(event) => {
                        if (treeBox.current) width.drag(event, treeBox.current);
                    }}
                    onDoubleClick={() => {
                        if (treeBox.current) {
                            width.fit(fittingWidth(rows, treeBox.current), treeBox.current);
                        }
                    }}
                >
                    <span className="absolute inset-y-1/4 left-[3px] w-0.5 rounded-sm group-hover:bg-ui-accent" />
                </div>
                <main className="min-w-0 flex-1 bg-ui-surface-subtle">{viewer}</main>
            </div>
        </div>
    );
}

/**
 * The tree's width, in a tile and full screen: the settings' once dragged, else the default. A drag moves the tree's edge
 * itself, with no render, and is stored when the button comes up; a double click fits every open
 * row, a second one goes back.
 */
function useTreeWidth() {
    const { filesTreeWidth, setFilesTreeWidth } = useRepositorySettings();
    // the width a drag ended on, shown until the settings change from the one it was dragged over
    const [dragged, setDragged] = useState<{ width: number; over: number | null } | null>(null);
    // the width before a fit, for the next double click to go back to
    const beforeFit = useRef<number | null | undefined>(undefined);
    const value = dragged?.over === filesTreeWidth ? dragged.width : (filesTreeWidth ?? TREE_WIDTH);

    const bounded = (width: number, box: HTMLElement) => {
        const room = (box.parentElement?.clientWidth ?? width) - VIEWER_MIN_WIDTH;
        return Math.round(Math.max(TREE_MIN_WIDTH, Math.min(room, width)));
    };

    return {
        value,
        drag: (event: PointerEvent<HTMLElement>, box: HTMLElement) => {
            if (event.button !== 0) return;
            event.preventDefault();
            const bar = event.currentTarget;
            const left = box.getBoundingClientRect().left;
            let last = value;
            bar.setPointerCapture(event.pointerId);
            const move = (moved: globalThis.PointerEvent) => {
                last = bounded(moved.clientX - left, box);
                box.style.width = `${last}px`;
            };
            const end = () => {
                bar.removeEventListener('pointermove', move);
                bar.removeEventListener('pointerup', end);
                bar.removeEventListener('pointercancel', end);
                beforeFit.current = undefined;
                setDragged({ width: last, over: filesTreeWidth });
                setFilesTreeWidth(last);
            };
            bar.addEventListener('pointermove', move);
            bar.addEventListener('pointerup', end);
            bar.addEventListener('pointercancel', end);
        },
        fit: (fitting: number, box: HTMLElement) => {
            if (beforeFit.current !== undefined) {
                setFilesTreeWidth(beforeFit.current);
                beforeFit.current = undefined;
                return;
            }
            const target = bounded(fitting, box);
            if (target <= box.clientWidth + 1) return;
            beforeFit.current = filesTreeWidth;
            setFilesTreeWidth(target);
        },
    };
}
