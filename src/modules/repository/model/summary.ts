import type { RepositorySummary } from './repository.types';

/** How many files changed, with a `+` when git listed more than were read. */
export function changedCount({ totals, truncated }: RepositorySummary): string {
    return truncated ? `${totals.files}+` : String(totals.files);
}
