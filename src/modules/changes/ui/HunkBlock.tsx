import { IconCheck, IconCopy } from '@tabler/icons-react';
import type { CopyState } from '@/shared/ui/hooks/use-copy-to-clipboard';
import type { DiffHunk, DiffLine } from '../model/diff-parser';

const ROW_TONE: Record<DiffLine['kind'], string> = {
    context: '',
    add: 'bg-ui-diff-add-bg',
    del: 'bg-ui-diff-del-bg',
    note: 'text-ui-text-muted italic',
};

const GUTTER_TONE: Record<DiffLine['kind'], string> = {
    context: 'text-ui-text-muted',
    add: 'bg-ui-diff-add-gutter text-ui-diff-add-mark',
    del: 'bg-ui-diff-del-gutter text-ui-diff-del-mark',
    note: 'text-ui-text-muted',
};

const SIGN: Record<DiffLine['kind'], string> = { context: '', add: '+', del: '−', note: '' };

/** One hunk. Clicking its header copies it, formatted for an agent. */
export function HunkBlock({
    hunk,
    copied,
    onCopy,
}: {
    hunk: DiffHunk;
    copied: CopyState;
    onCopy: () => void;
}) {
    return (
        <section className="border-b border-ui-border bg-ui-surface">
            <button
                type="button"
                onClick={onCopy}
                title="Copy this hunk, ready to paste to your agent"
                className="group flex w-full items-center gap-3 bg-ui-diff-hunk-bg px-4 py-1 text-left font-mono text-xs text-ui-diff-hunk-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-accent-muted focus-visible:ring-inset"
            >
                <span className="whitespace-pre">{hunk.header}</span>
                <span
                    className={`ml-auto flex items-center gap-1 font-sans font-medium transition-opacity ${
                        copied
                            ? 'opacity-100'
                            : 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100'
                    }`}
                >
                    {copied?.ok === false ? null : copied ? (
                        <IconCheck size={14} />
                    ) : (
                        <IconCopy size={14} />
                    )}
                    {copied ? (copied.ok ? 'Copied' : 'Copy failed') : 'Copy hunk'}
                </span>
            </button>
            <table className="w-full border-collapse font-mono text-xs leading-5">
                <tbody>
                    {hunk.lines.map((line) => (
                        <tr key={line.id} className={ROW_TONE[line.kind]}>
                            <td
                                className={`w-12 min-w-12 px-2 text-right tabular-nums select-none ${GUTTER_TONE[line.kind]}`}
                            >
                                {line.oldNumber ?? ''}
                            </td>
                            <td
                                className={`w-12 min-w-12 px-2 text-right tabular-nums select-none ${GUTTER_TONE[line.kind]}`}
                            >
                                {line.newNumber ?? ''}
                            </td>
                            <td
                                className={`w-5 min-w-5 text-center select-none ${GUTTER_TONE[line.kind]}`}
                            >
                                {SIGN[line.kind]}
                            </td>
                            <td className="pr-6 pl-1 whitespace-pre">{line.text}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </section>
    );
}
