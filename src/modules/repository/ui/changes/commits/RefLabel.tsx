import { IconCloud, IconGitBranch, IconTag } from '@tabler/icons-react';
import { HEAD_COLOR, UPSTREAM_COLOR } from '../../../model/history/graph';
import type { CommitRef } from '../../../model/repository.types';
import { laneColor } from './lane-color';

/** A ref's icon: a branch, the upstream's cloud as VS Code's, a tag. */
const REF_ICONS = { head: IconGitBranch, upstream: IconCloud, tag: IconTag } as const;

/** A branch's icon in its lane's color, which ties the name to the line it draws; a tag none. */
const REF_ICON_COLORS = {
    head: laneColor(HEAD_COLOR),
    upstream: laneColor(UPSTREAM_COLOR),
    tag: undefined,
} as const;

/**
 * A ref on its commit, its whole name: in a row under the whole panel, and in the tooltip.
 * Several on a commit share the room left, each down to its icon.
 */
function RefLabel({ commitRef, viewed }: { commitRef: CommitRef; viewed: boolean }) {
    const Icon = REF_ICONS[commitRef.kind];
    const surface = viewed
        ? 'bg-ui-surface text-ui-text-secondary'
        : commitRef.kind === 'head'
          ? 'bg-ui-accent-soft text-ui-accent-on-soft'
          : 'bg-ui-surface-subtle text-ui-text-secondary';
    return (
        <span
            title={commitRef.name}
            className={`inline-flex max-w-52 min-w-[22px] shrink items-center gap-1 rounded px-1.5 py-px font-mono text-[11px] ${surface}`}
        >
            <Icon size={11} className="shrink-0" color={REF_ICON_COLORS[commitRef.kind]} />
            <span className="truncate">{commitRef.name}</span>
        </span>
    );
}

/** A commit's refs, each as its label, in the order the backend gives them. */
export function RefLabels({ refs, viewed }: { refs: readonly CommitRef[]; viewed: boolean }) {
    return refs.map((commitRef) => (
        <RefLabel
            key={`${commitRef.kind}:${commitRef.name}`}
            commitRef={commitRef}
            viewed={viewed}
        />
    ));
}
