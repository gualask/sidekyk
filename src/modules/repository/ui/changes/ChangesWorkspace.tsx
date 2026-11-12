import { IconCircleCheck } from '@tabler/icons-react';
import type { UseQueryResult } from '@tanstack/react-query';
import { useTranslation } from '@/shared/i18n';
import type { PanelProps } from '@/shared/panels/panel';
import type { ProjectFolder, ProjectInfo } from '@/shared/projects/project-info';
import { remoteMachine } from '@/shared/projects/project-place';
import { useCommitView } from '../../application/commit-view';
import { useCommitFileFind, useFileFind } from '../../application/find';
import { useSelectedFile } from '../../application/selection';
import { useShownTarget } from '../../application/shown-target';
import { useFileViewChoice, useLinkedAnchor } from '../../application/view-choice';
import { hasPreview } from '../../model/preview/preview';
import { projectErrorMessage } from '../../model/project-error';
import type { RepositorySnapshot } from '../../model/repository.types';
import { selectedFile, selectionOf } from '../../model/selection';
import { fileTarget } from '../../model/targets';
import { fileKey } from '../../model/tree/file-groups';
import { ChangedFileView, type ShowInFiles } from './ChangedFileView';
import { CommitFileView } from './CommitFileView';
import { shownKeyOf } from './shown-key';
import { ChangesSidebar } from './sidebar/ChangesSidebar';
import { OtherFolders } from './sidebar/OtherFolders';
import { useListMoves } from './sidebar/use-list-moves';
import { UnchangedFileView } from './UnchangedFileView';
import { useChangeViews } from './use-change-views';
import { useDiffViewChoice } from './use-diff-view-choice';

/**
 * The Changes panel, the viewer of the project's files: what changed in its working tree, file by
 * file, and below it the recent commits. A commit clicked there shows its files in the list
 * instead, until going back to the working tree; a file picked in Files shows here too, as its
 * text when it did not change.
 */
export function ChangesWorkspace({ folder, ...props }: PanelProps) {
    // its panel shows only for a project with a folder
    return folder ? <Changes folder={folder} {...props} /> : null;
}

function Changes({
    project,
    folder,
    header,
    target,
    targetTaken,
    place,
    selected: hasKeys,
    show,
    findInFiles,
    showFolder,
}: Omit<PanelProps, 'folder'> & { folder: ProjectFolder }) {
    const folderId = folder.id;
    // the file shown, one for both panels: the tree of Files reveals it
    const {
        snapshot,
        files,
        selection,
        setSelection,
        change: selected,
        path: selectedPath,
    } = useSelectedFile(folderId, true);
    const commitView = useCommitView(folderId);
    const { commit: viewed, file: commitFile } = commitView;
    // the file shown, whose find bar goes when another shows
    const find = useFileFind(folderId, selected?.path ?? selectedPath, findInFiles);
    // a file of the tree that did not change, once the list says so
    const unchanged = !selected && snapshot.isSuccess ? selectedPath : null;
    const shownKey = shownKeyOf(viewed, commitFile, selected, unchanged);
    const { choice: diffView, openAt } = useDiffViewChoice(shownKey);
    // a file with a preview: how one that did not change shows, and whether a changed one shows
    // as it reads instead of its diff
    const fileView = useFileViewChoice();
    const views = useChangeViews(
        diffView,
        selected !== null && !viewed && selected.kind !== 'deleted' && hasPreview(selected.path),
    );
    const linked = useLinkedAnchor(selectedPath);
    const openLinked = (path: string, anchor: string | null) => {
        setSelection((current) => selectionOf(path, current));
        linked.link(path, anchor);
    };
    // a commit's file has a find bar of its own, which goes as the commit is left
    const commitFind = useCommitFileFind(viewed ? shownKey : null, findInFiles);

    // a file asked for from outside: the palette, Files
    useShownTarget(target, targetTaken, (shown) => {
        const next = selectionOf(shown.path, selection);
        setSelection(next);
        commitView.leave();
        if (shown.find) find.open(shown.path, shown.find);
        const { change } = selectedFile(next, files);
        if (shown.hunk !== null && change) openAt(fileKey(change), shown.hunk);
    });
    const stepFile = useListMoves({
        hasKeys,
        place,
        commitView,
        files,
        selectedIndex: selected ? files.indexOf(selected) : -1,
        selection,
        setSelection,
        unchanged,
        openAt,
    });

    // the file in the tree, and in Files full screen at the hunk being read
    const showInFiles: ShowInFiles = (path, hunk) => ({
        panel: 'files',
        onShow: () => show('files', fileTarget(path, hunk())),
    });

    return (
        <div className="flex h-full flex-col">
            <SnapshotNotices snapshot={snapshot} folder={folder} viewed={viewed !== null} />
            <div className="flex min-h-0 flex-1">
                <ChangesSidebar
                    folderId={folderId}
                    commitView={commitView}
                    files={snapshot.data?.files ?? []}
                    selectedKey={selected ? fileKey(selected) : null}
                    onSelect={(file) => setSelection({ kind: 'change', key: fileKey(file) })}
                    onView={(commit) => {
                        // a commit's files have their own bar
                        commitView.view(commit);
                        find.close();
                    }}
                />
                <main className="min-w-0 flex-1 bg-ui-surface-subtle">
                    {/* until the settings say which view a diff opens in, no diff is asked for */}
                    {!diffView ? null : viewed ? (
                        commitFile ? (
                            <CommitFileView
                                folderId={folderId}
                                commit={viewed}
                                file={commitFile}
                                shownKey={shownKey}
                                diffView={diffView}
                                views={views}
                                header={header}
                                finder={commitFind}
                                onPastEnd={stepFile}
                            />
                        ) : null
                    ) : selected ? (
                        <ChangedFileView
                            folderId={folderId}
                            file={selected}
                            shownKey={shownKey}
                            diffView={diffView}
                            views={views}
                            snapshot={snapshot}
                            header={header}
                            find={find}
                            onPastEnd={stepFile}
                            showInFiles={showInFiles}
                            openFile={openLinked}
                        />
                    ) : unchanged !== null ? (
                        <UnchangedFileView
                            folderId={folderId}
                            path={unchanged}
                            header={header}
                            finder={find.finderFor(unchanged)}
                            view={fileView.view}
                            onView={fileView.choose}
                            anchor={linked.anchorFor(unchanged)}
                            openFile={openLinked}
                            showInFiles={showInFiles}
                        />
                    ) : (
                        <NothingShown
                            snapshot={snapshot}
                            project={project}
                            folder={folder}
                            showFolder={showFolder}
                        />
                    )}
                </main>
            </div>
        </div>
    );
}

/** What the panel says over its list and viewer: a read that failed, a list cut short. */
function SnapshotNotices({
    snapshot,
    folder,
    viewed,
}: {
    snapshot: UseQueryResult<RepositorySnapshot>;
    folder: ProjectFolder;
    /** A commit is viewed: its files make room for the working tree's. */
    viewed: boolean;
}) {
    const i18n = useTranslation();
    return (
        <>
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
        </>
    );
}

/**
 * The viewer with no file to show: a working tree with no changes, which says so, or the first
 * read of a folder on another machine, which may start Sidekyk's helper there.
 */
function NothingShown({
    snapshot,
    project,
    folder,
    showFolder,
}: {
    snapshot: UseQueryResult<RepositorySnapshot>;
    project: ProjectInfo;
    folder: ProjectFolder;
    showFolder: (folderId: string) => void;
}) {
    const i18n = useTranslation();
    // the machine holding the folder when not this one: its first read may start Sidekyk's helper
    const machine = remoteMachine(folder);
    if (snapshot.isSuccess) {
        return (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-ui-text-muted">
                <IconCircleCheck size={32} stroke={1.5} />
                <p className="text-sm">{i18n.t('changes.nothing')}</p>
                <OtherFolders project={project} folder={folder} onShow={showFolder} />
            </div>
        );
    }
    if (!snapshot.isPending || !machine) return null;
    return (
        <div className="flex h-full items-center justify-center text-sm text-ui-text-muted">
            {i18n.t('projects.starting', { distro: machine })}
        </div>
    );
}
