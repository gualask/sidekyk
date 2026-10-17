import { IconFolder, IconGitCompare } from '@tabler/icons-react';
import type { DiffView } from '@/shared/git/diff-view';
import { CopyIcon } from '@/shared/ui/CopyIcon';
import {
    type CopyState,
    copyLabel,
    useCopyToClipboard,
} from '@/shared/ui/hooks/use-copy-to-clipboard';
import type { FileChange } from '../model/repository.types';
import { LineCounts } from './LineCounts';

const VIEWS: { value: DiffView; label: string; title: string }[] = [
    { value: 'changes', label: 'Changes', title: 'Only the changed lines' },
    { value: 'file', label: 'Full file', title: 'The whole file, changes highlighted' },
];

/** The way to the other panel, with the same file. */
const SHOW_IN = {
    files: { label: 'Show in Files', title: 'Show in Files, in the tree', Icon: IconFolder },
    changes: {
        label: 'Show in Changes',
        title: 'Show in Changes, change by change',
        Icon: IconGitCompare,
    },
} as const;

const ICON_BUTTON = 'btn-icon h-[26px] w-[26px]';

/**
 * The file open in a panel, in the panel's header: its path, what the panel shows nowhere else
 * about it (in Changes, that it did not change: its list already has a change's area and counts;
 * in Files, its area and counts), the view a diff shows in, the way to the other panel, and a
 * copy: of the diff when there is one, else of the path. Copy is an icon, as
 * everywhere: its tooltip says what it copies, and it turns into a check for a moment once done.
 */
export function FileHeader({
    path,
    origPath = null,
    badge = null,
    counts = null,
    view = null,
    showIn = null,
    copyDiff = null,
}: {
    path: string;
    /** The path before a rename. */
    origPath?: string | null;
    /** "Unchanged" in Changes; in Files, "Staged", "Not staged" or "New file". */
    badge?: { label: string; title?: string } | null;
    counts?: Pick<FileChange, 'additions' | 'deletions' | 'binary'> | null;
    /** The view a diff shows in, and its switch. */
    view?: { value: DiffView; onChange: (view: DiffView) => void } | null;
    showIn?: { panel: keyof typeof SHOW_IN; onShow: () => void } | null;
    /** The copy of the diff, null while it has no hunks; without it, the path copies. */
    copyDiff?: { copied: CopyState; onCopy: (() => void) | null } | null;
}) {
    const shown = origPath ? `${origPath} → ${path}` : path;
    const pathCopy = useCopyToClipboard();
    const copy = copyDiff
        ? {
              ...copyDiff,
              title: copyLabel(
                  copyDiff.copied,
                  'Copy the diff of this file, ready to paste to your agent',
              ),
          }
        : {
              copied: pathCopy.copied,
              onCopy: () => void pathCopy.copy('path', path),
              title: copyLabel(pathCopy.copied, 'Copy the path'),
          };
    const other = showIn ? SHOW_IN[showIn.panel] : null;

    return (
        <>
            <span className="flex min-w-0 flex-1 items-center gap-2 font-mono text-xs font-semibold text-ui-text-secondary">
                <span className="min-w-0 truncate" title={shown}>
                    {shown}
                </span>
                {badge ? (
                    <span
                        className="shrink-0 rounded-[5px] bg-ui-surface-hover px-1.5 py-px font-sans text-[11px] font-medium text-ui-text-muted"
                        title={badge.title}
                    >
                        {badge.label}
                    </span>
                ) : null}
                {counts ? (
                    <span className="shrink-0 text-[11.5px] font-normal">
                        <LineCounts
                            additions={counts.additions}
                            deletions={counts.deletions}
                            binary={counts.binary}
                        />
                    </span>
                ) : null}
            </span>
            {view ? (
                // plain buttons styled as segments: Base UI stays out of the first paint
                <fieldset className="seg" aria-label="Diff view">
                    {VIEWS.map((option) => (
                        <button
                            key={option.value}
                            type="button"
                            className="seg-item py-0.5 font-semibold"
                            title={option.title}
                            aria-pressed={option.value === view.value}
                            data-checked={option.value === view.value ? '' : undefined}
                            onClick={() => {
                                if (option.value !== view.value) view.onChange(option.value);
                            }}
                        >
                            {option.label}
                        </button>
                    ))}
                </fieldset>
            ) : null}
            {showIn && other ? (
                <button
                    type="button"
                    className={ICON_BUTTON}
                    title={other.title}
                    aria-label={other.label}
                    onClick={showIn.onShow}
                >
                    <other.Icon size={14} />
                </button>
            ) : null}
            <button
                type="button"
                className={ICON_BUTTON}
                disabled={copy.onCopy === null}
                title={copy.title}
                aria-label={copy.title}
                onClick={copy.onCopy ?? undefined}
            >
                <CopyIcon copied={copy.copied} />
            </button>
        </>
    );
}
