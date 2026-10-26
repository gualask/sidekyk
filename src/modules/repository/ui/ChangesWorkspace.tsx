import { IconCircleCheck } from '@tabler/icons-react';
import { useRef, useState } from 'react';
import type { DiffView } from '@/shared/git/diff-view';
import { useTranslation } from '@/shared/i18n';
import type { PanelProps } from '@/shared/panels/panel';
import { projectFolder } from '@/shared/projects/project-info';
import { useWindowKeys } from '@/shared/ui/hooks/use-window-keys';
import { isOwnKey } from '@/shared/ui/keys';
import { SidebarSplitter } from '@/shared/ui/SidebarSplitter';
import { useSidebarWidth } from '@/shared/ui/sidebar-width';
import { useShowToast } from '@/shared/ui/toasts';
import { useCommitView } from '../application/commit-view';
import { useCommitFileFind, useFileFind } from '../application/find';
import { useRepositorySettings } from '../application/repository-settings';
import { useSelectedFile } from '../application/selection';
import { useShownTarget } from '../application/shown-target';
import { useFileViewChoice, useLinkedAnchor } from '../application/view-choice';
import { fileKey } from '../model/file-groups';
import { hasPreview } from '../model/preview';
import { projectErrorMessage } from '../model/project-error';
import { selectedFile, selectionOf } from '../model/selection';
import { fileTarget } from '../model/targets';
import { CommitFileList } from './CommitFileList';
import { ChangeDiffView, CommitDiffView } from './DiffView';
import { FileHeader } from './FileHeader';
import { FileList } from './FileList';
import { fittingRowsWidth } from './list-layout';
import { PreviewPane } from './PreviewPane';
import { RecentCommits } from './RecentCommits';
import { TextFileView } from './TextFileView';
import { DIFF_VIEWS, PREVIEW_VIEW, type ViewSwitch } from './view-options';

const NEXT_KEYS = new Set(['ArrowDown', 'j']);
const PREVIOUS_KEYS = new Set(['ArrowUp', 'k']);
/** In a tile the arrows move among tiles: the list takes `j`/`k` only. */
const ARROWS = new Set(['ArrowDown', 'ArrowUp']);
/** What names a commit's file shown, as a working tree file's key does. */
function commitFileKey(sha: string, path: string): string {
    return `${sha}:${path}`;
}

/** The list's width by default, the same in a tile and full screen, and the least it takes. */
const LIST_WIDTH = { initial: 288, min: 200 };

/**
 * The Changes panel, the viewer of the project's files: what changed in its working tree, file by
 * file, and below it the recent commits. A commit clicked there shows its files in the list
 * instead, until going back to the working tree; a file picked in Files shows here too, as its
 * text when it did not change.
 */
export function ChangesWorkspace({
    project,
    header,
    target,
    place,
    selected: hasKeys,
    show,
    findInFiles,
}: PanelProps) {
    const i18n = useTranslation();
    // the file shown, one for both panels: the tree of Files reveals it
    const {
        snapshot,
        files,
        selection,
        setSelection,
        change: selected,
        path: selectedPath,
    } = useSelectedFile(project.id, true);
    const commitView = useCommitView(project.id);
    const { commit: viewed, file: commitFile } = commitView;
    // the file shown, whose find bar goes when another shows
    const find = useFileFind(project.id, selected?.path ?? selectedPath, findInFiles);
    const selectedIndex = selected ? files.indexOf(selected) : -1;
    // a file of the tree that did not change, once the list says so
    const unchanged = !selected && snapshot.isSuccess ? selectedPath : null;
    // the file shown: of the commit viewed, or of the working tree
    const shownKey = viewed
        ? commitFile
            ? commitFileKey(viewed.sha, commitFile.path)
            : null
        : selected
          ? fileKey(selected)
          : unchanged;
    const { choice: diffView, openAt } = useDiffViewChoice(shownKey);
    // a file with a preview: how one that did not change shows, and whether a changed one shows
    // as it reads instead of its diff, for the panel's files while it is open
    const fileView = useFileViewChoice();
    const [previewChanged, setPreviewChanged] = useState(false);
    const changedPreview =
        selected !== null &&
        !viewed &&
        selected.kind !== 'deleted' &&
        hasPreview(selected.path) &&
        previewChanged;
    const linked = useLinkedAnchor(selectedPath);
    const openLinked = (path: string, anchor: string | null) => {
        setSelection((current) => selectionOf(path, current));
        linked.link(path, anchor);
    };
    // a commit's file has a find bar of its own, which goes as the commit is left
    const commitFind = useCommitFileFind(viewed ? shownKey : null, findInFiles);

    // a file asked for from outside: the palette, Files
    useShownTarget(target, (shown) => {
        const next = selectionOf(shown.path, selection);
        setSelection(next);
        commitView.leave();
        if (shown.find) find.open(shown.path, shown.find);
        const { change } = selectedFile(next, files);
        if (shown.hunk !== null && change) openAt(fileKey(change), shown.hunk);
    });

    // the arrows move in the list on screen
    useWindowKeys((event) => {
        if (!hasKeys || (place === 'tile' && ARROWS.has(event.key)) || !isOwnKey(event)) return;
        const step = NEXT_KEYS.has(event.key) ? 1 : PREVIOUS_KEYS.has(event.key) ? -1 : 0;
        if (step === 0) return;
        if (viewed) {
            const next = commitView.neighbour(step);
            if (!next) return;
            event.preventDefault();
            commitView.open(next);
            return;
        }
        const next = files[selectedIndex + step];
        if (!next) return;
        event.preventDefault();
        setSelection({ kind: 'change', key: fileKey(next) });
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
    const stepFile = (step: 1 | -1) => {
        const hunk = step > 0 ? 0 : -1;
        if (viewed) {
            const next = commitView.neighbour(step);
            if (next) {
                commitView.open(next);
                openAt(commitFileKey(viewed.sha, next.path), hunk);
                return;
            }
        } else {
            const next = files[selectedIndex + step];
            if (next) {
                setSelection({ kind: 'change', key: fileKey(next) });
                openAt(fileKey(next), hunk);
                return;
            }
        }
        showToast({ title: i18n.t(step > 0 ? 'changes.last' : 'changes.first') });
    };

    // the file in the tree, and in Files full screen at the hunk being read
    const showInFiles = (path: string, hunk: () => number | null) => ({
        panel: 'files' as const,
        onShow: () => show('files', fileTarget(path, hunk())),
    });
    // a changed file with a preview (`path`, null for none) may show as it reads too, the diff's
    // view staying as chosen
    const viewSwitch = (
        currentHunk: () => number,
        path: string | null = null,
    ): ViewSwitch<DiffView | 'preview'> | null =>
        diffView
            ? {
                  value: changedPreview ? 'preview' : diffView.view,
                  options:
                      path !== null && hasPreview(path)
                          ? [...DIFF_VIEWS, PREVIEW_VIEW]
                          : DIFF_VIEWS,
                  onChange: (next) => {
                      setPreviewChanged(next === 'preview');
                      if (next !== 'preview') diffView.onChange(next, currentHunk());
                  },
              }
            : null;

    const listWidth = useSidebarWidth('changes', LIST_WIDTH);
    const folder = projectFolder(project);
    const listBox = useRef<HTMLElement>(null);

    return (
        <div className="flex h-full flex-col">
            {snapshot.isError ? (
                <div className="border-b border-ui-border bg-ui-danger-soft px-4 py-2 text-sm text-ui-danger-soft-text">
                    {projectErrorMessage(snapshot.error, folder, i18n)}
                </div>
            ) : null}
            {/* about the working tree: not shown while its files make room for a commit's */}
            {snapshot.data?.summary.truncated && !viewed ? (
                <div className="border-b border-ui-border bg-ui-warning-soft px-4 py-2 text-sm text-ui-warning-soft-text">
                    {i18n.t('changes.tooMany', {
                        count: snapshot.data.summary.totals.files.toLocaleString(i18n.formatTag),
                    })}
                </div>
            ) : null}
            <div className="flex min-h-0 flex-1">
                <aside
                    ref={listBox}
                    className="flex shrink-0 flex-col border-r border-ui-border bg-ui-surface"
                    style={listWidth.style}
                >
                    <div className="min-h-0 flex-1">
                        {viewed ? (
                            <CommitFileList
                                commit={viewed}
                                files={commitView.files}
                                selectedPath={commitFile?.path ?? null}
                                onSelect={commitView.open}
                                onBack={commitView.leave}
                            />
                        ) : (
                            <FileList
                                files={snapshot.data?.files ?? []}
                                selectedKey={selected ? fileKey(selected) : null}
                                onSelect={(file) =>
                                    setSelection({ kind: 'change', key: fileKey(file) })
                                }
                            />
                        )}
                    </div>
                    <RecentCommits
                        projectId={project.id}
                        open={commitView.listOpen}
                        onOpenChange={commitView.setListOpen}
                        viewed={viewed}
                        onView={(commit) => {
                            // a commit's files have their own bar
                            commitView.view(commit);
                            find.close();
                        }}
                    />
                </aside>
                <SidebarSplitter
                    width={listWidth}
                    box={listBox}
                    place="edge"
                    fitting={(box) =>
                        fittingRowsWidth(
                            viewed
                                ? (commitView.files.data?.files ?? [])
                                : (snapshot.data?.files ?? []),
                            box,
                        )
                    }
                    what="list"
                />
                <main className="min-w-0 flex-1 bg-ui-surface-subtle">
                    {/* until the settings say which view a diff opens in, no diff is asked for */}
                    {!diffView ? null : viewed ? (
                        commitFile && commitFind ? (
                            <CommitDiffView
                                key={`${shownKey}:${diffView.view}`}
                                projectId={project.id}
                                commit={viewed}
                                file={commitFile}
                                view={diffView.view}
                                openOn={diffView.openOn}
                                header={header}
                                finder={commitFind}
                                onPastEnd={stepFile}
                                renderHeader={(pane) => (
                                    <FileHeader
                                        path={commitFile.path}
                                        uncolored={pane.uncolored}
                                        origPath={commitFile.origPath}
                                        view={viewSwitch(pane.currentHunk)}
                                        copyDiff={{
                                            copied: pane.fileCopied,
                                            onCopy: pane.copyFile,
                                        }}
                                    />
                                )}
                            />
                        ) : null
                    ) : selected && changedPreview ? (
                        <PreviewPane
                            key={`${shownKey}:preview`}
                            projectId={project.id}
                            path={selected.path}
                            header={header}
                            renderHeader={() => (
                                <FileHeader
                                    path={selected.path}
                                    origPath={selected.origPath}
                                    view={viewSwitch(() => 0, selected.path)}
                                    showIn={showInFiles(selected.path, () => null)}
                                />
                            )}
                            openOn={null}
                            openFile={openLinked}
                            onFind={(line) => {
                                setPreviewChanged(false);
                                find.open(selected.path, { query: '', line: line ?? 1 });
                            }}
                        />
                    ) : selected ? (
                        <ChangeDiffView
                            key={`${shownKey}:${diffView.view}`}
                            projectId={project.id}
                            file={selected}
                            snapshot={snapshot}
                            view={diffView.view}
                            openOn={diffView.openOn}
                            header={header}
                            finder={find.finderFor(selected.path)}
                            onPastEnd={stepFile}
                            renderHeader={(pane) => (
                                <FileHeader
                                    path={selected.path}
                                    uncolored={pane.uncolored}
                                    origPath={selected.origPath}
                                    view={viewSwitch(
                                        pane.currentHunk,
                                        // a deleted file has nothing to show as it reads
                                        selected.kind === 'deleted' ? null : selected.path,
                                    )}
                                    showIn={
                                        // a deleted file is not in the tree
                                        selected.kind === 'deleted'
                                            ? null
                                            : showInFiles(selected.path, pane.currentHunk)
                                    }
                                    copyDiff={{ copied: pane.fileCopied, onCopy: pane.copyFile }}
                                />
                            )}
                        />
                    ) : unchanged !== null ? (
                        <TextFileView
                            key={unchanged}
                            projectId={project.id}
                            path={unchanged}
                            header={header}
                            finder={find.finderFor(unchanged)}
                            view={fileView.view}
                            onView={fileView.choose}
                            anchor={linked.anchorFor(unchanged)}
                            openFile={openLinked}
                            renderHeader={({ uncolored, view }) => (
                                <FileHeader
                                    path={unchanged}
                                    uncolored={uncolored}
                                    badge={{
                                        label: i18n.t('changes.unchanged'),
                                        title: i18n.t('changes.unchangedTitle'),
                                    }}
                                    view={view}
                                    showIn={showInFiles(unchanged, () => null)}
                                />
                            )}
                        />
                    ) : snapshot.isSuccess ? (
                        <div className="flex h-full flex-col items-center justify-center gap-2 text-ui-text-muted">
                            <IconCircleCheck size={32} stroke={1.5} />
                            <p className="text-sm">{i18n.t('changes.nothing')}</p>
                        </div>
                    ) : snapshot.isPending && folder?.kind === 'wsl' ? (
                        // the first read may start Sidekyk's helper in the distro
                        <div className="flex h-full items-center justify-center text-sm text-ui-text-muted">
                            {i18n.t('projects.starting', { distro: folder.distro })}
                        </div>
                    ) : null}
                </main>
            </div>
        </div>
    );
}

/** How a diff shows, and how it switches: the panel keeps the view across files. */
interface DiffViewChoice {
    view: DiffView;
    /** The hunk to open on, after a switch; otherwise the first. */
    openOn: number | null;
    /** Switches the view, opening it on `hunk`. */
    onChange: (view: DiffView, hunk: number) => void;
}

/**
 * The view diffs show in: the settings' until the header switches it, and again once the setting
 * changes. A switch opens the new view on the hunk that was being read, as `openAt` opens a file
 * on a hunk; showing another file forgets it, so every file opens on its first change. The choice
 * is null until the settings are read.
 */
function useDiffViewChoice(shownKey: string | null): {
    choice: DiffViewChoice | null;
    openAt: (file: string, hunk: number) => void;
} {
    const defaultView = useRepositorySettings().diffView;
    const [chosen, setChosen] = useState<{ view: DiffView; over: DiffView } | null>(null);
    const [switched, setSwitched] = useState<{ file: string | null; hunk: number } | null>(null);
    // another file shows: the hunk of the last switch was in the one before
    if (switched && switched.file !== shownKey) setSwitched(null);
    const openAt = (file: string, hunk: number) => setSwitched({ file, hunk });
    if (!defaultView) return { choice: null, openAt };
    const view = chosen?.over === defaultView ? chosen.view : defaultView;
    return {
        choice: {
            view,
            openOn: switched?.file === shownKey ? switched.hunk : null,
            onChange: (next, hunk) => {
                setChosen({ view: next, over: defaultView });
                setSwitched({ file: shownKey, hunk });
            },
        },
        openAt,
    };
}
