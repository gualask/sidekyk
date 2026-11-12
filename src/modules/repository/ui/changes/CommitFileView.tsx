import type { FileFinder } from '../../application/find';
import { commitSides, imageSides } from '../../model/diff/sides';
import { isImage } from '../../model/preview/preview';
import type { Commit, FileChange } from '../../model/repository.types';
import { CommitDiffView } from '../viewer/diff/DiffView';
import { ImageDiff } from '../viewer/diff/ImageDiff';
import { FileHeader } from '../viewer/FileHeader';
import type { ChangeViews } from './use-change-views';
import type { DiffViewChoice } from './use-diff-view-choice';

/**
 * A file of the commit viewed, against the commit's parent: an image's two sides, else its diff in
 * the view chosen, once its find bar is there.
 */
export function CommitFileView({
    folderId,
    commit,
    file,
    shownKey,
    diffView,
    views,
    header,
    finder,
    onPastEnd,
}: {
    folderId: string;
    commit: Commit;
    file: FileChange;
    /** What names the file shown (`shownKeyOf`), which keys its view. */
    shownKey: string | null;
    diffView: DiffViewChoice;
    views: ChangeViews;
    /** The panel's header, where the open file goes (see `PanelProps`). */
    header: HTMLElement | null;
    finder: FileFinder | null;
    /** Where `n`/`p` go past the last or the first change. */
    onPastEnd: (step: 1 | -1) => void;
}) {
    if (isImage(file.path)) {
        return (
            <ImageDiff
                key={`${shownKey}:image`}
                folderId={folderId}
                sides={imageSides(commitSides(commit, file), file)}
                header={header}
                onPastEnd={onPastEnd}
                renderHeader={() => <FileHeader path={file.path} origPath={file.origPath} />}
            />
        );
    }
    if (!finder) return null;
    return (
        <CommitDiffView
            key={`${shownKey}:${diffView.view}`}
            folderId={folderId}
            commit={commit}
            file={file}
            view={diffView.view}
            openOn={diffView.openOn}
            header={header}
            finder={finder}
            onPastEnd={onPastEnd}
            renderHeader={(pane) => (
                <FileHeader
                    path={file.path}
                    uncolored={pane.uncolored}
                    origPath={file.origPath}
                    view={views.diffSwitch(pane.currentHunk)}
                    copyDiff={{ copied: pane.fileCopied, onCopy: pane.copyFile }}
                />
            )}
        />
    );
}
