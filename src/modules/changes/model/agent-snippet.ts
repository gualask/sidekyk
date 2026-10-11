import type { DiffHunk, DiffLine } from './diff-parser';

const PREFIX: Record<DiffLine['kind'], string> = { context: ' ', add: '+', del: '-', note: '' };

/** A fence longer than any backtick run in the body, so quoted code cannot close it early. */
function fenceFor(body: string): string {
    const longest = Math.max(0, ...(body.match(/`+/g) ?? []).map((run) => run.length));
    return '`'.repeat(Math.max(3, longest + 1));
}

function lineRange(start: number, count: number): string {
    return count <= 1 ? `${start}` : `${start}-${start + count - 1}`;
}

/**
 * Where a hunk sits, as `path:start-end` on the new side. A hunk that only removes lines has no
 * new side, so it points at the old lines instead.
 */
export function hunkLocation(path: string, hunk: DiffHunk): string {
    if (hunk.newLines > 0) return `${path}:${lineRange(hunk.newStart, hunk.newLines)}`;
    return `${path}:${lineRange(hunk.oldStart, hunk.oldLines)} (removed lines)`;
}

/**
 * A hunk as text an agent reads well: the location on its own line, then the lines in a
 * `diff` fence.
 */
export function formatHunkForAgent(path: string, hunk: DiffHunk): string {
    const body = hunk.lines.map((line) => `${PREFIX[line.kind]}${line.text}`).join('\n');
    const fence = fenceFor(body);
    return [hunkLocation(path, hunk), `${fence}diff`, body, fence].join('\n');
}

/** Every hunk of a file, one block each. */
export function formatFileForAgent(path: string, hunks: readonly DiffHunk[]): string {
    return hunks.map((hunk) => formatHunkForAgent(path, hunk)).join('\n\n');
}
