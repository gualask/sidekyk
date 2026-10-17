import { Popover } from '@base-ui/react/popover';
import { IconAlertTriangle } from '@tabler/icons-react';
import type { Problem } from './problems';

/**
 * The top bar's warning: how many problems last, and their list with their fixes, the usual one
 * first. Loaded with the
 * first problem, with Base UI's popover.
 */
export function ProblemsButton({ problems }: { problems: Problem[] }) {
    const count = problems.length;
    return (
        <Popover.Root>
            <Popover.Trigger
                className="flex h-[26px] items-center gap-1.5 rounded-[7px] bg-ui-warning-soft px-2.5 text-xs font-bold text-ui-warning-soft-text outline-none focus-visible:ring-2 focus-visible:ring-ui-accent-muted"
                title="Something needs your attention"
                aria-label={count === 1 ? '1 problem' : `${count} problems`}
            >
                <IconAlertTriangle size={14} stroke={2} />
                {count}
            </Popover.Trigger>
            <Popover.Portal>
                <Popover.Positioner sideOffset={6} align="end" collisionPadding={10}>
                    <Popover.Popup className="w-[340px] max-w-[calc(100vw-20px)] rounded-xl border border-ui-border-hover bg-ui-surface p-1.5 shadow-[0_16px_40px_var(--ui-shadow-soft)] outline-none">
                        <Popover.Title className="sr-only">Problems</Popover.Title>
                        <ul className="divide-y divide-ui-border">
                            {problems.map((problem) => (
                                <li key={problem.id} className="flex items-start gap-2.5 p-2.5">
                                    <div className="min-w-0 flex-1 text-[12.5px]">
                                        <div className="font-bold break-words">{problem.title}</div>
                                        <div className="mt-0.5 break-words text-ui-text-muted">
                                            {problem.detail}
                                        </div>
                                    </div>
                                    <div className="flex shrink-0 flex-col items-stretch gap-1.5">
                                        {problem.fixes.map((fix) => (
                                            <Popover.Close
                                                key={fix.label}
                                                className="btn-ghost-sm justify-center"
                                                onClick={fix.run}
                                            >
                                                {fix.label}
                                            </Popover.Close>
                                        ))}
                                    </div>
                                </li>
                            ))}
                        </ul>
                    </Popover.Popup>
                </Popover.Positioner>
            </Popover.Portal>
        </Popover.Root>
    );
}
