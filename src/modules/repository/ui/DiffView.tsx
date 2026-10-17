import { IconFileOff } from '@tabler/icons-react';
import type { UseQueryResult } from '@tanstack/react-query';
import { type ReactNode, useMemo } from 'react';
import { errorMessage } from '@/shared/errors/app-error';
import type { DiffView } from '@/shared/git/diff-view';
import type { FileFinder } from '../application/find';
import { useCommitFileDiff, useFileDiff } from '../application/repository.queries';
import { commitRequest, shortSha } from '../model/commits';
import { parseUnifiedDiff } from '../model/diff-parser';
import { diffRows, wholeFileRows, widestLine } from '../model/diff-rows';
import type { ChangedFile, Commit, FileChange, UnifiedDiff } from '../model/repository.types';
import { wholeFile } from '../model/whole-file';
import { Notice, Pane, type PaneHeader } from './Pane';

/** Lines left above the change the whole file opens on, so it shows where it sits. */
const LINES_ABOVE = 3;

/** How a diff shows: only its changes or the whole file, opened on a hunk or on the first. */
interface DiffShown {
    view: DiffView;
    /** The hunk to open on; the first if null. */
    openOn: number | null;
    /** The panel's header, where the open file goes (see `PanelProps`). */
    header: HTMLElement | null;
    renderHeader: (pane: PaneHeader) => ReactNode;
    /** What the file is looked through with. */
    finder: FileFinder;
}

/** A diff, in either view. */
function DiffPane({
    diff,
    file,
    commit,
    view,
    openOn,
    header,
    renderHeader,
    finder,
}: DiffShown & {
    diff: UseQueryResult<UnifiedDiff | null>;
    file: FileChange;
    /** The commit shown (its short hash); null for the working tree. */
    commit: string | null;
}) {
    const parsed = useMemo(
        () => (diff.data ? parseUnifiedDiff(diff.data.text) : null),
        [diff.data],
    );
    // the whole file comes as one hunk: its changes, as git's hunks, for their copy
    const whole = useMemo(
        () => (parsed && view === 'file' ? wholeFile(parsed.hunks) : null),
        [parsed, view],
    );
    const rows = useMemo(
        () => (whole ? wholeFileRows(whole) : diffRows(parsed?.hunks ?? [])),
        [whole, parsed],
    );
    const widest = useMemo(() => widestLine(parsed?.hunks ?? []), [parsed]);
    // what `{row}` names: the file, its path before a rename, and the commit shown, if any
    const source = useMemo(
        () => ({ path: file.path, origPath: file.origPath, commit }),
        [file.path, file.origPath, commit],
    );
    const hunks = whole?.hunks ?? parsed?.hunks ?? [];

    return (
        <Pane
            header={header}
            renderHeader={renderHeader}
            source={source}
            rows={rows}
            hunks={hunks}
            widest={widest}
            openOn={openOn}
            linesAbove={whole ? LINES_ABOVE : 0}
            finder={finder}
        >
            {diff.isPending ? <Notice>Loading diff…</Notice> : null}
            {diff.isError ? (
                <Notice>
                    <span className="text-ui-danger">{errorMessage(diff.error)}</span>
                </Notice>
            ) : null}
            {parsed?.binary ? (
                <Notice>
                    <IconFileOff size={28} stroke={1.5} />
                    Binary file, no text to show.
                </Notice>
            ) : null}
            {parsed && !parsed.binary && hunks.length === 0 ? (
                <Notice>No line changes (only mode or metadata changed).</Notice>
            ) : null}
            {diff.data?.truncated ? (
                <Notice>
                    {view === 'file'
                        ? 'The file is too large to show whole: it was cut here.'
                        : 'The diff is too large and was cut. Open the file to see the rest.'}
                </Notice>
            ) : null}
        </Pane>
    );
}

/** A file changed in the working tree, in its area: in Changes, and in Files whole. */
export function ChangeDiffView({
    root,
    file,
    ...shown
}: DiffShown & { root: string; file: ChangedFile }) {
    const diff = useFileDiff(root, {
        path: file.path,
        origPath: file.origPath,
        area: file.area,
        wholeFile: shown.view === 'file',
    });
    return <DiffPane diff={diff} file={file} commit={null} {...shown} />;
}

/** A file of a commit, against the commit's parent. */
export function CommitDiffView({
    root,
    commit,
    file,
    ...shown
}: DiffShown & { root: string; commit: Commit; file: FileChange }) {
    const diff = useCommitFileDiff(root, {
        commit: commitRequest(commit),
        path: file.path,
        origPath: file.origPath,
        wholeFile: shown.view === 'file',
    });
    return <DiffPane diff={diff} file={file} commit={shortSha(commit.sha)} {...shown} />;
}
