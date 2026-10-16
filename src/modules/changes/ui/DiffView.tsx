import { IconFileOff } from '@tabler/icons-react';
import type { UseQueryResult } from '@tanstack/react-query';
import { type ReactNode, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { errorMessage } from '@/shared/errors/app-error';
import { CHANGE_AREA_LABEL } from '@/shared/git/change-area';
import type { DiffView } from '@/shared/git/diff-view';
import { useCopyToClipboard } from '@/shared/ui/hooks/use-copy-to-clipboard';
import { useChangesSettings } from '../application/changes-settings';
import { useCommitFileDiff, useFileDiff } from '../application/repository.queries';
import { commitRequest, shortSha } from '../model/commits';
import { fileText } from '../model/copied';
import { parseUnifiedDiff } from '../model/diff-parser';
import { diffRows, wholeFileRows, widestLine } from '../model/diff-rows';
import type { ChangedFile, Commit, FileChange, UnifiedDiff } from '../model/repository.types';
import { wholeFile } from '../model/whole-file';
import { DiffList } from './DiffList';
import { FileHeader } from './FileHeader';

function Notice({ children }: { children: ReactNode }) {
    return (
        <div className="flex flex-col items-center justify-center gap-2 py-16 text-sm text-ui-text-muted">
            {children}
        </div>
    );
}

/** Lines left above the change the whole file opens on, so it shows where it sits. */
const LINES_ABOVE = 3;

/** How a diff shows, and how it switches: the panel keeps the view across files. */
export interface DiffViewChoice {
    view: DiffView;
    /** The hunk to open on, after a switch; otherwise the first. */
    openOn: number | null;
    /** Switches the view, opening it on `hunk`. */
    onChange: (view: DiffView, hunk: number) => void;
}

function DiffPane({
    diff,
    file,
    badge,
    header,
    choice,
    commit,
}: {
    diff: UseQueryResult<UnifiedDiff | null>;
    file: FileChange;
    /** Where the change is, next to the path (see `FileHeader`). */
    badge: { label: string; title?: string };
    /** The panel's header, where the open file goes (see `PanelProps`). */
    header: HTMLElement | null;
    choice: DiffViewChoice;
    /** The commit shown (its short hash); null for the working tree. */
    commit: string | null;
}) {
    const { view, openOn } = choice;
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
    const { copyTemplate } = useChangesSettings();
    // what `{row}` names: the file, its path before a rename, and the commit shown, if any
    const copySource = useMemo(
        () => ({ path: file.path, origPath: file.origPath, commit }),
        [file.path, file.origPath, commit],
    );
    // state, not a ref: React attaches a parent's ref after its children's effects, so lines
    // mounted with it, from a diff already read, would find no element to scroll
    const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null);
    const currentHunk = useRef<(() => number) | null>(null);
    const { copied, copy } = useCopyToClipboard();
    const hunks = whole?.hunks ?? parsed?.hunks ?? [];
    const fileCopied = copied?.id === 'file' ? copied : null;

    return (
        <div className="flex h-full flex-col">
            {header
                ? createPortal(
                      <FileHeader
                          file={file}
                          badge={badge}
                          view={view}
                          onViewChange={(next) =>
                              choice.onChange(next, currentHunk.current?.() ?? 0)
                          }
                          copied={fileCopied}
                          onCopy={
                              hunks.length > 0
                                  ? () =>
                                        void copy('file', fileText(copyTemplate, copySource, hunks))
                                  : null
                          }
                      />,
                      header,
                  )
                : null}
            <div ref={setScrollElement} className="min-h-0 flex-1 overflow-auto">
                {scrollElement && hunks.length > 0 ? (
                    <DiffList
                        source={copySource}
                        rows={rows}
                        hunks={hunks}
                        widest={widest}
                        scrollElement={scrollElement}
                        openOn={openOn}
                        linesAbove={whole ? LINES_ABOVE : 0}
                        currentHunk={currentHunk}
                    />
                ) : null}

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
            </div>
        </div>
    );
}

/** The diff of a file changed in the working tree, in its area. */
export function ChangeDiffView({
    root,
    file,
    header,
    choice,
}: {
    root: string;
    file: ChangedFile;
    header: HTMLElement | null;
    choice: DiffViewChoice;
}) {
    const diff = useFileDiff(root, {
        path: file.path,
        origPath: file.origPath,
        area: file.area,
        wholeFile: choice.view === 'file',
    });
    return (
        <DiffPane
            diff={diff}
            file={file}
            badge={{ label: CHANGE_AREA_LABEL[file.area] }}
            header={header}
            choice={choice}
            commit={null}
        />
    );
}

/** The diff of a file of a commit, against the commit's parent. */
export function CommitDiffView({
    root,
    commit,
    file,
    header,
    choice,
}: {
    root: string;
    commit: Commit;
    file: FileChange;
    header: HTMLElement | null;
    choice: DiffViewChoice;
}) {
    const diff = useCommitFileDiff(root, {
        commit: commitRequest(commit),
        path: file.path,
        origPath: file.origPath,
        wholeFile: choice.view === 'file',
    });
    return (
        <DiffPane
            diff={diff}
            file={file}
            badge={{ label: shortSha(commit.sha), title: commit.subject }}
            header={header}
            choice={choice}
            commit={shortSha(commit.sha)}
        />
    );
}
