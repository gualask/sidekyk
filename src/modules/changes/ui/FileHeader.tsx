import type { DiffView } from '@/shared/git/diff-view';
import { CopyIcon } from '@/shared/ui/CopyIcon';
import { type CopyState, copyLabel } from '@/shared/ui/hooks/use-copy-to-clipboard';
import type { FileChange } from '../model/repository.types';
import { LineCounts } from './LineCounts';

const VIEWS: { value: DiffView; label: string; title: string }[] = [
    { value: 'changes', label: 'Changes', title: 'Only the changed lines' },
    { value: 'file', label: 'Full file', title: 'The whole file, changes highlighted' },
];

/**
 * The open file in the panel's header: its path, where it comes from (its area, or its commit)
 * and counts, the view it shows in, and the copy of the whole file. Copy is an icon, as
 * everywhere: its tooltip says what it copies, and it turns into a check for a moment once done.
 */
export function FileHeader({
    file,
    badge,
    view,
    onViewChange,
    copied,
    onCopy,
}: {
    file: FileChange;
    /** Where the change is: "Staged", "Not staged", or a commit's hash with its subject. */
    badge: { label: string; title?: string };
    view: DiffView;
    onViewChange: (view: DiffView) => void;
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
                <span
                    className="shrink-0 rounded-[5px] bg-ui-surface-hover px-1.5 py-px font-sans text-[11px] font-medium text-ui-text-muted"
                    title={badge.title}
                >
                    {badge.label}
                </span>
                <span className="shrink-0 text-[11.5px] font-normal">
                    <LineCounts
                        additions={file.additions}
                        deletions={file.deletions}
                        binary={file.binary}
                    />
                </span>
            </span>
            {/* plain buttons styled as segments: Base UI stays out of the first paint */}
            <fieldset className="seg" aria-label="Diff view">
                {VIEWS.map((option) => (
                    <button
                        key={option.value}
                        type="button"
                        className="seg-item py-0.5 font-semibold"
                        title={option.title}
                        aria-pressed={option.value === view}
                        data-checked={option.value === view ? '' : undefined}
                        onClick={() => {
                            if (option.value !== view) onViewChange(option.value);
                        }}
                    >
                        {option.label}
                    </button>
                ))}
            </fieldset>
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
