import type { Translator } from '@/shared/i18n';
import type { Commit, CommitRequest } from './repository.types';

/** The abbreviated hash the UI shows, as long as the branch's commit in the summary. */
export function shortSha(sha: string): string {
    return sha.slice(0, 7);
}

/** What the backend needs to name a commit, without the rest of it on the wire. */
export function commitRequest(commit: Commit): CommitRequest {
    return { sha: commit.sha, parent: commit.parent };
}

/** When a commit was made, in full, for a tooltip. */
export function commitDate(commit: Commit, { formatTag }: Translator): string {
    return new Date(commit.time * 1000).toLocaleString(formatTag);
}
