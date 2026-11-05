import { IconClock, IconCopyMinus, IconFileText, IconListTree } from '@tabler/icons-react';
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { errorMessage } from '@/shared/errors/app-error';
import { CHANGE_AREA_LABEL } from '@/shared/git/change-area';
import { useTranslation } from '@/shared/i18n';
import type { PanelProps } from '@/shared/panels/panel';
import type { ProjectFolder } from '@/shared/projects/project-info';
import { useWindowKeys } from '@/shared/ui/hooks/use-window-keys';
import { isOwnKey } from '@/shared/ui/keys';
import { SidebarSplitter } from '@/shared/ui/SidebarSplitter';
import { useSessionState } from '@/shared/ui/session-state';
import { useSidebarWidth } from '@/shared/ui/sidebar-width';
import { useFileFind } from '../application/find';
import {
    useFolderKind,
    useRecentFiles,
    useTreeDirectories,
} from '../application/repository.queries';
import { useSelectedFile } from '../application/selection';
import { useShownTarget } from '../application/shown-target';
import { useFileViewChoice, useLinkedAnchor } from '../application/view-choice';
import { changeMarks, foldersAbove, treeMove, treeRows } from '../model/file-tree';
import { recentMove, recentRows } from '../model/recent-files';
import { selectionOf } from '../model/selection';
import { type FileLines, fileTarget } from '../model/targets';
import { ChangeDiffView } from './DiffView';
import { LINES_ABOVE } from './diff-layout';
import { FileHeader } from './FileHeader';
import { FileTree } from './FileTree';
import { RecentList } from './RecentList';
import { recentFittingWidth, timeFormats } from './recent-layout';
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

/** How Files lists the project's files: as a tree, or by their last change (Recent). */
type FilesView = 'tree' | 'recent';

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

/** The line the viewer opens on for some lines: a few above them, as a change opens. */
function openingLine({ first }: FileLines): number {
    return Math.max(1, first - LINES_ABOVE);
}

/**
 * The Files panel: the project's files as a tree, or by their last change (Recent). The file shown
 * is the one of Changes (one selection for both): the tree reveals it, Recent selects it, and a
 * file picked in either shows there; what this says of the tree holds for Recent too. In a tile
 * Files is the tree alone: a file picked shows in Changes, or in a folder without git, where there
 * is no Changes, in Files full screen. Full screen the file shows next to the tree, a changed one
 * whole with its changes marked, any other as its text. No filter here: the command palette finds
 * files, and shows them in the tree.
 */
export function FilesWorkspace({ folder, ...props }: PanelProps) {
    // its panel shows only for a project with a folder
    return folder ? <Files folder={folder} {...props} /> : null;
}

function Files({
    project,
    folder,
    header,
    tileFit,
    target,
    targetTaken,
    place,
    selected: hasKeys,
    show,
    findInFiles,
    zoomIn,
}: Omit<PanelProps, 'folder'> & { folder: ProjectFolder }) {
    const i18n = useTranslation();
    const folderId = folder.id;
    const [state, setState] = useSessionState<TreeState>(`tree:${folderId}`, CLOSED);
    const { open, selected } = state;
    const [view, setView] = useSessionState<FilesView>(`files-view:${folderId}`, 'tree');
    // Recent's row the keyboard is on, apart from the tree's: a folder is never one
    const [recentSelected, setRecentSelected] = useSessionState<string | null>(
        `recent-selected:${folderId}`,
        null,
    );
    const repository = useFolderKind(folder).kind === 'repository';
    // the file shown, one for both panels: Changes selects it in its list
    const {
        snapshot,
        files,
        setSelection,
        change,
        path: file,
        lines: marked,
    } = useSelectedFile(folderId, repository);
    const find = useFileFind(folderId, change?.path ?? file, findInFiles);
    // the hunk a file asked for from Changes opens on, until another file shows
    const [openOn, setOpenOn] = useState<{ file: string; hunk: number } | null>(null);
    // how many times lines were asked for: the viewer opens on the marked lines as it mounts, and
    // again at each request
    const [linesAsked, setLinesAsked] = useState(0);
    // how a file with a preview shows, and the element a link of one named in the file it leads to
    const fileView = useFileViewChoice();
    const linked = useLinkedAnchor(file);
    const marks = useMemo(() => changeMarks(files), [files]);
    const { read, error } = useTreeDirectories(folderId, open);
    const rows = useMemo(() => treeRows(open, read), [open, read]);
    // read only while it shows; grouped by day as of the read, since no timer runs
    const recent = useRecentFiles(folderId, view === 'recent');
    const { formatTag } = i18n;
    const listed = useMemo(() => {
        const now = Date.now();
        const { files: dated = [], more = 0 } = recent.data ?? {};
        return { rows: recentRows(dated, more, now), formats: timeFormats(formatTag, now) };
    }, [recent.data, formatTag]);
    const shown =
        view === 'tree'
            ? { error, truncated: read('')?.truncated ?? false }
            : { error: recent.error, truncated: recent.data?.truncated ?? false };
    // what fits every row the view shows whole
    const fitting = useCallback(
        (box: HTMLElement) =>
            view === 'tree'
                ? fittingWidth(rows, box)
                : recentFittingWidth(listed.rows, listed.formats, box),
        [view, rows, listed],
    );

    // the file shown, wherever it was picked, is revealed: the folders above it open, and Recent
    // selects it
    const reveal = useEffectEvent((path: string) => {
        setState((current) => ({
            open: new Set([...current.open, ...foldersAbove(path)]),
            selected: path,
        }));
        setRecentSelected(path);
    });
    useEffect(() => {
        if (file) reveal(file);
    }, [file]);

    const openFile = (path: string, hunk: number | null = null, lines: FileLines | null = null) => {
        setSelection((current) => selectionOf(path, current, lines));
        setOpenOn(hunk === null ? null : { file: path, hunk });
    };
    // a file picked shows beside the tree full screen; from a tile in Changes, or without git in
    // Files full screen
    const pick = (path: string) => {
        openFile(path);
        if (!repository) zoomIn?.();
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
    useShownTarget(target, targetTaken, (shown) => {
        openFile(shown.path, shown.hunk, shown.lines);
        reveal(shown.path);
        if (shown.find) find.open(shown.path, shown.find);
        if (shown.lines) setLinesAsked((count) => count + 1);
    });

    // before the workspace's keys, so `↵` opens what is selected instead of zooming; in a tile a
    // file moved to becomes the one shown, as in Changes' list: there at once, without git once
    // `↵` zooms in
    useWindowKeys(
        (event) => {
            const ours = place === 'full' ? FULL_KEYS : TILE_KEYS;
            if (!hasKeys || !ours.has(event.key) || event.defaultPrevented) return;
            if (!isOwnKey(event)) return;
            if (view === 'recent') {
                const move = recentMove(listed.rows, recentSelected, event.key);
                if (!move) return;
                event.preventDefault();
                if (move.kind === 'open') pick(move.path);
                else if (place === 'tile') openFile(move.path);
                else setRecentSelected(move.path);
                return;
            }
            const move = treeMove(rows, selected, event.key);
            if (!move) return;
            event.preventDefault();
            if (move.kind === 'toggle') toggle(move.path);
            else if (move.kind === 'open') pick(move.path);
            else if (place === 'tile' && !move.folder) openFile(move.path);
            else setState((current) => ({ ...current, selected: move.path }));
        },
        { capture: true },
    );

    const treeWidth = useSidebarWidth('files', FILES_TREE_WIDTH);
    const treeBox = useRef<HTMLDivElement>(null);
    // the other view's icon, as VS Code's "View as Tree" and "View as List"; then, for the tree,
    // VS Code's "Collapse Folders in Explorer": the file shown is revealed again once another is
    // picked
    const other = view === 'tree' ? 'files.showRecent' : 'files.showTree';
    const actions = header
        ? createPortal(
              <>
                  {/* in a tile the buttons sit on the right, by the zoom, as Changes' actions do */}
                  {place === 'tile' ? <span className="flex-1" /> : null}
                  <button
                      type="button"
                      className="btn-icon h-[26px] w-[26px]"
                      title={i18n.t(other)}
                      aria-label={i18n.t(other)}
                      onClick={() => setView(view === 'tree' ? 'recent' : 'tree')}
                  >
                      {view === 'tree' ? <IconClock size={14} /> : <IconListTree size={14} />}
                  </button>
                  {view === 'tree' ? (
                      <button
                          type="button"
                          className="btn-icon h-[26px] w-[26px]"
                          title={i18n.t('files.collapse')}
                          aria-label={i18n.t('files.collapse')}
                          disabled={open.size === 0}
                          onClick={() => setState((current) => ({ ...current, open: new Set() }))}
                      >
                          <IconCopyMinus size={14} />
                      </button>
                  ) : null}
              </>,
              header,
          )
        : null;
    const label = i18n.t('files.of', { name: project.name });
    const empty = view === 'recent' && recent.data?.files.length === 0;
    const listing = (
        <div className="flex h-full flex-col">
            {shown.error ? (
                <div className="px-3 py-2 font-sans text-sm text-ui-danger">
                    {errorMessage(shown.error, i18n)}
                </div>
            ) : null}
            {empty ? (
                <div className="px-3 py-2 font-sans text-sm text-ui-text-muted">
                    {i18n.t('files.recent.empty')}
                </div>
            ) : null}
            <div className="min-h-0 flex-1">
                {view === 'tree' ? (
                    <FileTree
                        rows={rows}
                        marks={marks}
                        selected={selected}
                        label={label}
                        onClick={(row) => {
                            if (row.kind === 'folder') toggle(row.path);
                            else pick(row.path);
                        }}
                    />
                ) : (
                    <RecentList
                        rows={listed.rows}
                        formats={listed.formats}
                        marks={marks}
                        selected={recentSelected}
                        label={label}
                        onClick={pick}
                    />
                )}
            </div>
        </div>
    );
    const tooMany = shown.truncated ? (
        <div className="border-b border-ui-border bg-ui-warning-soft px-3 py-2 text-sm text-ui-warning-soft-text">
            {i18n.t('files.tooMany')}
        </div>
    ) : null;

    // in a tile, the tile's splitter fits the tree, as the tree's own does full screen
    useEffect(() => {
        if (!tileFit) return;
        tileFit(() => (treeBox.current ? fitting(treeBox.current) : 0));
        return () => tileFit(null);
    }, [tileFit, fitting]);

    // the tree's edge, by the file viewer full screen
    const splitter = (
        <SidebarSplitter
            width={treeWidth}
            box={treeBox}
            place="edge"
            fitting={fitting}
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
                {actions}
                {tooMany}
                <div className="min-h-0 flex-1">{listing}</div>
            </div>
        );
    }

    // the change shown, a deleted file too though the tree does not have it; else the file
    const lineShown = marked ? openingLine(marked) : null;
    const opening = marked ? linesAsked : '';
    const viewer = change ? (
        <ChangeDiffView
            key={`${change.area}:${change.path}:${opening}`}
            folderId={folderId}
            file={change}
            snapshot={snapshot}
            view="file"
            openOn={openOn?.file === change.path ? openOn.hunk : null}
            openOnLine={lineShown}
            marked={marked}
            header={header}
            finder={find.finderFor(change.path)}
            renderHeader={(pane) => (
                <FileHeader
                    path={change.path}
                    uncolored={pane.uncolored}
                    badge={{ label: i18n.t(CHANGE_AREA_LABEL[change.area]) }}
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
            <p className="text-sm">{i18n.t('files.pick')}</p>
            <p className="text-xs">{i18n.t('files.readOnly')}</p>
        </div>
    ) : repository && !snapshot.isSuccess ? null : (
        <TextFileView
            key={`${file}:${opening}`}
            folderId={folderId}
            path={file}
            header={header}
            finder={find.finderFor(file)}
            view={fileView.view}
            onView={fileView.choose}
            anchor={linked.anchorFor(file)}
            openOnLine={lineShown}
            marked={marked}
            openFile={(path, anchor) => {
                openFile(path);
                linked.link(path, anchor);
            }}
            renderHeader={({ uncolored, view }) => (
                <FileHeader path={file} uncolored={uncolored} view={view} />
            )}
        />
    );

    return (
        <div className="flex h-full flex-col">
            {actions}
            {tooMany}
            <div className="flex min-h-0 flex-1">
                <div
                    ref={treeBox}
                    className="shrink-0 border-r border-ui-border bg-ui-surface font-mono text-[12.5px]"
                    style={treeWidth.style}
                >
                    {listing}
                </div>
                {splitter}
                <main className="min-w-0 flex-1 bg-ui-surface-subtle">{viewer}</main>
            </div>
        </div>
    );
}
