import type { useFileFind } from '../../application/find';
import type { SnapshotRead } from '../../application/queries/formatting-check';
import { changeSides, imageSides } from '../../model/diff/sides';
import { isImage } from '../../model/preview/preview';
import type { ChangedFile } from '../../model/repository.types';
import { ChangeDiffView } from '../viewer/diff/DiffView';
import { ImageDiff } from '../viewer/diff/ImageDiff';
import { FileHeader } from '../viewer/FileHeader';
import { PreviewPane } from '../viewer/preview/PreviewPane';
import type { ChangeViews } from './use-change-views';
import type { DiffViewChoice } from './use-diff-view-choice';

/** The way to a file in Files, at the hunk being read (none: the file's top). */
export type ShowInFiles = (
    path: string,
    hunk: () => number | null,
) => { panel: 'files'; onShow: () => void };

/** A changed file of the working tree, shown in the panel, and what its header does. */
interface ChangedFileProps {
    folderId: string;
    file: ChangedFile;
    /** What names the file shown (`shownKeyOf`), which keys its view. */
    shownKey: string | null;
    diffView: DiffViewChoice;
    views: ChangeViews;
    /** The snapshot the file is from. */
    snapshot: SnapshotRead;
    /** The panel's header, where the open file goes (see `PanelProps`). */
    header: HTMLElement | null;
    find: ReturnType<typeof useFileFind>;
    /** Where `n`/`p` go past the last or the first change. */
    onPastEnd: (step: 1 | -1) => void;
    showInFiles: ShowInFiles;
    /** Opens a file a link of the preview names, at its anchor. */
    openFile: (path: string, anchor: string | null) => void;
}

/** A changed file of the working tree: as it reads when the header says so, else its diff. */
export function ChangedFileView(props: ChangedFileProps) {
    if (props.views.preview) return <ChangedPreview {...props} />;
    if (isImage(props.file.path)) return <ChangedImage {...props} />;
    return <ChangedDiff {...props} />;
}

/** A changed file as it reads, its header switching back to its diff. */
function ChangedPreview({
    folderId,
    file,
    shownKey,
    views,
    header,
    find,
    showInFiles,
    openFile,
}: ChangedFileProps) {
    return (
        <PreviewPane
            key={`${shownKey}:preview`}
            folderId={folderId}
            path={file.path}
            header={header}
            renderHeader={() => (
                <FileHeader
                    path={file.path}
                    origPath={file.origPath}
                    view={
                        isImage(file.path)
                            ? views.imageSwitch
                            : views.diffSwitch(() => 0, file.path)
                    }
                    showIn={showInFiles(file.path, () => null)}
                />
            )}
            openOn={null}
            openFile={openFile}
            onFind={(line) => {
                views.leavePreview();
                find.open(file.path, { query: '', line: line ?? 1 });
            }}
        />
    );
}

/** A changed image, its two sides. */
function ChangedImage({
    folderId,
    file,
    shownKey,
    views,
    header,
    onPastEnd,
    showInFiles,
}: ChangedFileProps) {
    return (
        <ImageDiff
            key={`${shownKey}:image`}
            folderId={folderId}
            sides={imageSides(changeSides(file), file)}
            header={header}
            onPastEnd={onPastEnd}
            renderHeader={() => (
                <FileHeader
                    path={file.path}
                    origPath={file.origPath}
                    // a deleted image has nothing to show as it reads
                    view={file.kind === 'deleted' ? null : views.imageSwitch}
                    showIn={file.kind === 'deleted' ? null : showInFiles(file.path, () => null)}
                />
            )}
        />
    );
}

/** A changed file's diff, in the view chosen. */
function ChangedDiff({
    folderId,
    file,
    shownKey,
    diffView,
    views,
    snapshot,
    header,
    find,
    onPastEnd,
    showInFiles,
}: ChangedFileProps) {
    return (
        <ChangeDiffView
            key={`${shownKey}:${diffView.view}`}
            folderId={folderId}
            file={file}
            snapshot={snapshot}
            view={diffView.view}
            openOn={diffView.openOn}
            header={header}
            finder={find.finderFor(file.path)}
            onPastEnd={onPastEnd}
            renderHeader={(pane) => (
                <FileHeader
                    path={file.path}
                    uncolored={pane.uncolored}
                    origPath={file.origPath}
                    view={views.diffSwitch(
                        pane.currentHunk,
                        // a deleted file has nothing to show as it reads
                        file.kind === 'deleted' ? null : file.path,
                    )}
                    showIn={
                        // a deleted file is not in the tree
                        file.kind === 'deleted' ? null : showInFiles(file.path, pane.currentHunk)
                    }
                    copyDiff={{ copied: pane.fileCopied, onCopy: pane.copyFile }}
                />
            )}
        />
    );
}
