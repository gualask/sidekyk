import type { RepositorySummary } from './repository.types';

/** How many files changed, kept short (`1.2k`), with a `+` when git listed more than were read. */
export function changedCount({ totals, truncated }: RepositorySummary): string {
    const files = compactCount(totals.files);
    return truncated ? `${files}+` : files;
}

/** A count kept short, rounded down: `340`, `1.2k`, `48k`, `1.2M`. */
export function compactCount(count: number): string {
    if (count < 1_000) return String(count);
    if (count < 10_000) return `${Math.floor(count / 100) / 10}k`;
    if (count < 1_000_000) return `${Math.floor(count / 1_000)}k`;
    return `${Math.floor(count / 100_000) / 10}M`;
}
