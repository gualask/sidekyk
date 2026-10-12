import { CopyIcon } from '@/shared/ui/CopyIcon';
import { type CopyState, copyLabel } from '@/shared/ui/hooks/use-copy-to-clipboard';
import type { ChangeArea, ChangedFile } from '../model/repository.types';
import { LineCounts } from './LineCounts';

const AREA_LABEL: Record<ChangeArea, string> = {
    unstaged: 'Not staged',
    untracked: 'New file',
    staged: 'Staged',
};

/**
 * The open file in the panel's header: its path, its area and counts, and the copy of the whole
 * file. Copy is an icon, as everywhere: its tooltip says what it copies, and it turns into a check
 * for a moment once done.
 */
export function FileHeader({
    file,
    copied,
    onCopy,
}: {
    file: ChangedFile;
    copied: CopyState;
    /** null while there is nothing to copy (no hunks). */
    onCopy: (() => void) | null;
}) {
    const path = file.origPath ? `${file.origPath} → ${file.path}` : file.path;
    const copyTitle = copyLabel(copied, 'Copy the diff of this file, ready to paste to your agent');

    return (
        <>
            <span className="flex min-w-0 flex-1 items-center gap-2 font-mono text-xs font-semibold text-ui-text-secondary">
                <span className="min-w-0 truncate" title={path}>
                    {path}
                </span>
                <span className="shrink-0 rounded-[5px] bg-ui-surface-hover px-1.5 py-px font-sans text-[11px] font-medium text-ui-text-muted">
                    {AREA_LABEL[file.area]}
                </span>
                <span className="shrink-0 text-[11.5px] font-normal">
                    <LineCounts
                        additions={file.additions}
                        deletions={file.deletions}
                        binary={file.binary}
                    />
                </span>
            </span>
            <button
                type="button"
                className="btn-icon h-[26px] w-[26px]"
                disabled={onCopy === null}
                title={copyTitle}
                aria-label={copyTitle}
                onClick={onCopy ?? undefined}
            >
                <CopyIcon copied={copied} />
            </button>
        </>
    );
}
