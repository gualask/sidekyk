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

/** A hunk's `@@` header. Clicking it copies the hunk, formatted for an agent. */
export function HunkHeaderRow({
    hunk,
    first,
    copied,
    onCopy,
}: {
    hunk: DiffHunk;
    first: boolean;
    copied: CopyState;
    onCopy: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onCopy}
            title="Copy this hunk, ready to paste to your agent"
            className={`group flex h-6 w-full items-center gap-3 bg-ui-diff-hunk-bg px-4 text-left text-ui-diff-hunk-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-accent-muted focus-visible:ring-inset ${
                first ? '' : 'border-t border-ui-border'
            }`}
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
    );
}

export function DiffLineRow({ line }: { line: DiffLine }) {
    const gutter = `shrink-0 select-none ${GUTTER_TONE[line.kind]}`;
    return (
        <div className={`flex h-5 leading-5 ${ROW_TONE[line.kind]}`}>
            <span className={`w-12 px-2 text-right tabular-nums ${gutter}`}>
                {line.oldNumber ?? ''}
            </span>
            <span className={`w-12 px-2 text-right tabular-nums ${gutter}`}>
                {line.newNumber ?? ''}
            </span>
            <span className={`w-5 text-center ${gutter}`}>{SIGN[line.kind]}</span>
            <span className="flex-1 pr-6 pl-1 whitespace-pre">{line.text}</span>
        </div>
    );
}
