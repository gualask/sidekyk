import { IconFileOff } from '@tabler/icons-react';
import type { UseQueryResult } from '@tanstack/react-query';
import { type ReactNode, useMemo } from 'react';
import type { DiffView } from '@/shared/git/diff-view';
import { useTranslation } from '@/shared/i18n';
import type { FileFinder } from '../application/find';
import {
    type FormattingCheck,
    type SnapshotRead,
    useCommitFileDiff,
    useFileDiff,
    useFormattingCheck,
} from '../application/repository.queries';
import { commitRequest, shortSha } from '../model/commits';
import { parseUnifiedDiff } from '../model/diff-parser';
import { diffRows, wholeFileRows, widestLine } from '../model/diff-rows';
import type { ChangedFile, Commit, FileChange, UnifiedDiff } from '../model/repository.types';
import { changeSides, commitSides } from '../model/sides';
import type { FileSyntax } from '../model/syntax';
import type { FileLines } from '../model/targets';
import { wholeFile } from '../model/whole-file';
import { LINES_ABOVE } from './diff-layout';
import { FormattingNotice } from './FormattingNotice';
import { ErrorText, Notice, Pane, type PaneHeader } from './Pane';

/** How a diff shows: only its changes or the whole file, opened on a hunk or on the first. */
interface DiffShown {
    view: DiffView;
    /** The hunk to open on; the first if null. */
    openOn: number | null;
    /** A file's line to open on instead, the whole file's. */
    openOnLine?: number | null;
    /** Lines marked, by their numbers now: those a note names. */
    marked?: FileLines | null;
    /** The panel's header, where the open file goes (see `PanelProps`). */
    header: HTMLElement | null;
    renderHeader: (pane: PaneHeader) => ReactNode;
    /** What the file is looked through with. */
    finder: FileFinder;
    /** Where `n`/`p` go past the last or the first change (see `Pane`). */
    onPastEnd?: (step: 1 | -1) => void;
}

/** A diff, in either view. */
function DiffPane({
    diff,
    file,
    commit,
    syntax,
    formattingCheck,
    view,
    openOn,
    openOnLine = null,
    marked = null,
    header,
    renderHeader,
    finder,
    onPastEnd,
}: DiffShown & {
    diff: UseQueryResult<UnifiedDiff | null>;
    file: FileChange;
    /** The commit shown (its short hash); null for the working tree. */
    commit: string | null;
    syntax: FileSyntax;
    /** Counts formatting over every change: the working tree's diffs only. */
    formattingCheck?: FormattingCheck;
}) {
    const i18n = useTranslation();
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
            openOnLine={openOnLine}
            marked={marked}
            linesAbove={whole ? LINES_ABOVE : 0}
            finder={finder}
            syntax={syntax}
            // until the diff is read there are no changes to go through: the keys wait
            onPastEnd={diff.isPending ? undefined : onPastEnd}
            banner={
                parsed && parsed.formattingLines > 0 ? (
                    <FormattingNotice
                        lines={parsed.formattingLines}
                        changed={parsed.changedLines}
                        check={formattingCheck}
                    />
                ) : null
            }
        >
            {diff.isPending ? <Notice>{i18n.t('view.loadingDiff')}</Notice> : null}
            {diff.isError ? (
                <Notice>
                    <ErrorText error={diff.error} />
                </Notice>
            ) : null}
            {parsed?.binary ? (
                <Notice>
                    <IconFileOff size={28} stroke={1.5} />
                    {i18n.t('view.binary')}
                </Notice>
            ) : null}
            {parsed && !parsed.binary && hunks.length === 0 ? (
                <Notice>{i18n.t('view.noLineChanges')}</Notice>
            ) : null}
            {diff.data?.truncated ? (
                <Notice>{i18n.t(view === 'file' ? 'view.fileCut' : 'view.diffCut')}</Notice>
            ) : null}
        </Pane>
    );
}

/** A file changed in the working tree, in its area: in Changes, and in Files whole. */
export function ChangeDiffView({
    folderId,
    file,
    snapshot,
    ...shown
}: DiffShown & {
    folderId: string;
    file: ChangedFile;
    /** The snapshot the file is from, which formatting is counted over when asked. */
    snapshot: SnapshotRead;
}) {
    const formattingCheck = useFormattingCheck(folderId, snapshot);
    const diff = useFileDiff(folderId, {
        path: file.path,
        origPath: file.origPath,
        area: file.area,
        wholeFile: shown.view === 'file',
    });
    const { path, origPath, area } = file;
    const syntax = useMemo(
        () => ({ folderId, sides: changeSides({ path, origPath, area }) }),
        [folderId, path, origPath, area],
    );
    return (
        <DiffPane
            diff={diff}
            file={file}
            commit={null}
            syntax={syntax}
            formattingCheck={formattingCheck}
            {...shown}
        />
    );
}

/** A file of a commit, against the commit's parent. */
export function CommitDiffView({
    folderId,
    commit,
    file,
    ...shown
}: DiffShown & { folderId: string; commit: Commit; file: FileChange }) {
    const diff = useCommitFileDiff(folderId, {
        commit: commitRequest(commit),
        path: file.path,
        origPath: file.origPath,
        wholeFile: shown.view === 'file',
    });
    const { sha, parent } = commit;
    const { path, origPath } = file;
    const syntax = useMemo(
        () => ({ folderId, sides: commitSides({ sha, parent }, { path, origPath }) }),
        [folderId, sha, parent, path, origPath],
    );
    return (
        <DiffPane
            diff={diff}
            file={file}
            commit={shortSha(commit.sha)}
            syntax={syntax}
            {...shown}
        />
    );
}
