import type { ChangeKind } from '../model/repository.types';

const LETTER: Record<ChangeKind, string> = {
    added: 'A',
    modified: 'M',
    deleted: 'D',
    renamed: 'R',
    copied: 'C',
    'type-changed': 'T',
    untracked: 'U',
    conflicted: '!',
};

const BADGE_TONE: Record<ChangeKind, string> = {
    added: 'bg-ui-success-soft text-ui-success-soft-text',
    untracked: 'bg-ui-success-soft text-ui-success-soft-text',
    deleted: 'bg-ui-danger-soft text-ui-danger-soft-text',
    conflicted: 'bg-ui-warning-soft text-ui-warning-soft-text',
    modified: 'bg-ui-accent-soft text-ui-accent-on-soft',
    renamed: 'bg-ui-accent-soft text-ui-accent-on-soft',
    copied: 'bg-ui-accent-soft text-ui-accent-on-soft',
    'type-changed': 'bg-ui-accent-soft text-ui-accent-on-soft',
};

/** The letter of a change (M, A, D, U…) in its color. */
export function KindBadge({ kind }: { kind: ChangeKind }) {
    return (
        <span
            className={`flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded font-mono text-[10px] font-bold ${BADGE_TONE[kind]}`}
        >
            {LETTER[kind]}
        </span>
    );
}
