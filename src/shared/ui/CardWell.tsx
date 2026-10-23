import type { ReactNode } from 'react';

/**
 * The well at the bottom of a project's card: the week of commits or why there is none, or a
 * project's notes' last change. One height whatever it holds, so that cards side by side line up:
 * the chart's 16 px caption, 6 px gap and 56 px bars, in 12 px of padding.
 */
export function CardWell({ children }: { children: ReactNode }) {
    return (
        <div className="card-box h-[102px] p-3 text-[11px] leading-4 text-ui-text-muted">
            {children}
        </div>
    );
}

/** A sentence alone in the well, in its middle. */
export function WellMessage({
    className = '',
    children,
}: {
    className?: string;
    children: ReactNode;
}) {
    return (
        <p className={`flex h-full items-center justify-center text-center text-xs ${className}`}>
            {children}
        </p>
    );
}
