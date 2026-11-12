import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { useTranslation } from '@/shared/i18n';
import type { PanelProps } from '@/shared/panels/panel';
import type { ProjectFolder } from '@/shared/projects/project-info';
import { SidebarSplitter } from '@/shared/ui/SidebarSplitter';
import { useSessionState } from '@/shared/ui/session-state';
import { useSidebarWidth } from '@/shared/ui/sidebar-width';
import { useFileFind } from '../../application/find';
import { useFolderKind } from '../../application/queries/folder-kind';
import { useSelectedFile } from '../../application/selection';
import { useShownTarget } from '../../application/shown-target';
import { selectionOf } from '../../model/selection';
import type { FileLines } from '../../model/targets';
import { changeMarks } from '../../model/tree/file-tree';
import { FilesActions, type FilesView } from './FilesActions';
import { FilesListing, TooManyFiles } from './FilesListing';
import { FileViewer } from './FileViewer';
import { recentFittingWidth } from './recent-layout';
import { FILES_TREE_WIDTH, fittingWidth } from './tree-layout';
import { useFileTree } from './use-file-tree';
import { useFilesKeys } from './use-files-keys';
import { useRecentList } from './use-recent-list';

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
    const [view, setView] = useSessionState<FilesView>(`files-view:${folderId}`, 'tree');
    const tree = useFileTree(folderId);
    const recent = useRecentList(folderId, view === 'recent');
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
    const marks = useMemo(() => changeMarks(files), [files]);
    const shown =
        view === 'tree'
            ? { error: tree.error, truncated: tree.truncated() }
            : { error: recent.error, truncated: recent.truncated };
    // what fits every row the view shows whole
    const fitting = useCallback(
        (box: HTMLElement) =>
            view === 'tree'
                ? fittingWidth(tree.rows, box)
                : recentFittingWidth(recent.listed.rows, recent.listed.formats, box),
        [view, tree.rows, recent.listed],
    );

    // the file shown, wherever it was picked, is revealed: the folders above it open, and Recent
    // selects it
    const reveal = useEffectEvent((path: string) => {
        tree.reveal(path);
        recent.select(path);
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

    // a file asked for from Changes, at the hunk being read there; revealed again even when it is
    // the file shown already, as the keyboard may have left it
    useShownTarget(target, targetTaken, (shown) => {
        openFile(shown.path, shown.hunk, shown.lines);
        reveal(shown.path);
        if (shown.find) find.open(shown.path, shown.find);
        if (shown.lines) setLinesAsked((count) => count + 1);
    });
    useFilesKeys({ active: hasKeys, place, view, tree, recent, pick, openFile });

    const treeWidth = useSidebarWidth('files', FILES_TREE_WIDTH);
    const treeBox = useRef<HTMLDivElement>(null);
    const actions = header ? (
        <FilesActions
            header={header}
            place={place}
            view={view}
            onView={setView}
            canCollapse={tree.open.size > 0}
            onCollapse={tree.collapse}
        />
    ) : null;
    const label = i18n.t('files.of', { name: project.name });
    const listing = (
        <FilesListing
            view={view}
            error={shown.error}
            tree={tree}
            recent={recent}
            marks={marks}
            label={label}
            onPick={pick}
        />
    );
    const tooMany = shown.truncated ? <TooManyFiles /> : null;

    // in a tile, the tile's splitter fits the tree, as the tree's own does full screen
    useEffect(() => {
        if (!tileFit) return;
        tileFit(() => (treeBox.current ? fitting(treeBox.current) : 0));
        return () => tileFit(null);
    }, [tileFit, fitting]);

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
                {/* the tree's edge, by the file viewer full screen */}
                <SidebarSplitter
                    width={treeWidth}
                    box={treeBox}
                    place="edge"
                    fitting={fitting}
                    what="tree"
                />
                <main className="min-w-0 flex-1 bg-ui-surface-subtle">
                    <FileViewer
                        folderId={folderId}
                        repository={repository}
                        snapshot={snapshot}
                        change={change}
                        file={file}
                        marked={marked}
                        linesAsked={linesAsked}
                        openOn={openOn}
                        header={header}
                        finderFor={find.finderFor}
                        show={show}
                        openFile={openFile}
                    />
                </main>
            </div>
        </div>
    );
}
