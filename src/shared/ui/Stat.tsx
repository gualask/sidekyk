import type { ReactNode } from 'react';

/**
 * A number on a card in a box of its own, with what it counts under it; `quiet` when there is
 * nothing to see. Boxes in a row take their content's width, and share what is left.
 */
export function Stat({
    value,
    label,
    quiet = false,
}: {
    value: ReactNode;
    label: string;
    quiet?: boolean;
}) {
    return (
        <div className="card-box flex min-w-0 flex-auto flex-col p-2">
            <span
                className={`text-base leading-5 font-semibold whitespace-nowrap tabular-nums ${
                    quiet ? 'text-ui-text-muted' : 'text-ui-text'
                }`}
            >
                {value}
            </span>
            <span className="text-[11px] leading-4 whitespace-nowrap text-ui-text-muted">
                {label}
            </span>
        </div>
    );
}
