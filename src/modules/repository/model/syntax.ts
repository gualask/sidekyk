import type { DiffLine } from './diff-parser';
import type {
    ChangedFile,
    Commit,
    FileChange,
    FileVersion,
    LineColors,
    SyntaxColors,
    SyntaxTone,
} from './repository.types';

/** Lines asked for at once: the backend colors a version whole, then serves it a block at a time. */
export const COLOR_BLOCK = 256;

/** A version of a file whose lines are colored. */
export interface ColorSource {
    path: string;
    version: FileVersion;
}

/**
 * Where the viewer's lines take their colors: a removed line from the old version, every other
 * line from the new one. A side is null when there is none (a new file, a root commit).
 */
export interface ColorSides {
    old: ColorSource | null;
    new: ColorSource | null;
}

type Side = keyof ColorSides;

/** What a viewer's lines are colored from: the sides of a file in a project. */
export interface FileSyntax {
    projectId: string;
    sides: ColorSides;
}

/** A block of lines of one side, from its first line. */
export interface ColorBlock {
    side: Side;
    first: number;
}

/** A line's colored parts. */
export type LineSpans = LineColors['spans'];

/** The blocks read, by `blockKey`. */
export type ReadBlocks = ReadonlyMap<string, SyntaxColors>;

export function blockKey({ side, first }: ColorBlock): string {
    return `${side}:${first}`;
}

/** FNV-1a over the UTF-16 units, as the backend hashes each line it colors. */
export function lineCheck(text: string): number {
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index++) {
        hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193) >>> 0;
    }
    return hash;
}

/** The sides of a working-tree change: an area compares two of the working tree, index and HEAD. */
export function changeSides(file: Pick<ChangedFile, 'path' | 'origPath' | 'area'>): ColorSides {
    const was = file.origPath ?? file.path;
    if (file.area === 'staged') {
        return {
            old: { path: was, version: { kind: 'head' } },
            new: { path: file.path, version: { kind: 'index' } },
        };
    }
    return {
        old: file.area === 'unstaged' ? { path: was, version: { kind: 'index' } } : null,
        new: { path: file.path, version: { kind: 'worktree' } },
    };
}

/** The sides of a file of a commit: the commit, against its parent. */
export function commitSides(
    commit: Pick<Commit, 'sha' | 'parent'>,
    file: Pick<FileChange, 'path' | 'origPath'>,
): ColorSides {
    return {
        old: commit.parent
            ? { path: file.origPath ?? file.path, version: { kind: 'commit', sha: commit.parent } }
            : null,
        new: { path: file.path, version: { kind: 'commit', sha: commit.sha } },
    };
}

/** A file of the working tree, as the Files panel shows it. */
export function fileSides(path: string): ColorSides {
    return { old: null, new: { path, version: { kind: 'worktree' } } };
}

/** The side a line takes its colors from and its number there; null for a note. */
function lineSource(line: DiffLine): { side: Side; number: number } | null {
    if (line.kind === 'note') return null;
    if (line.kind === 'del') {
        return line.oldNumber === null ? null : { side: 'old', number: line.oldNumber };
    }
    return line.newNumber === null ? null : { side: 'new', number: line.newNumber };
}

/** The block a line falls in, and its place there; null for a note. */
function lineBlock(line: DiffLine): { block: ColorBlock; offset: number } | null {
    const source = lineSource(line);
    if (!source) return null;
    const offset = (source.number - 1) % COLOR_BLOCK;
    return { block: { side: source.side, first: source.number - offset }, offset };
}

/** The blocks these lines fall in, each once, on the sides there are. */
export function blocksOf(lines: Iterable<DiffLine>, sides: ColorSides): ColorBlock[] {
    const blocks = new Map<string, ColorBlock>();
    for (const line of lines) {
        const found = lineBlock(line);
        if (found && sides[found.block.side]) blocks.set(blockKey(found.block), found.block);
    }
    return [...blocks.values()];
}

/** A line's colors from the blocks read, only while its text is the one they were colored for. */
export function lineColors(read: ReadBlocks, line: DiffLine): LineSpans | undefined {
    const found = lineBlock(line);
    const colors = found ? read.get(blockKey(found.block))?.lines[found.offset] : undefined;
    return colors?.check === lineCheck(line.text) ? colors.spans : undefined;
}

/** A part of a line: its tone (null for the text's own color), and the match it is in, if any. */
export interface TextPart {
    text: string;
    tone: SyntaxTone | null;
    /** The index of the match it is in, among the line's. */
    found: number | null;
}

type Range = readonly [start: number, end: number];

/**
 * A line cut where its colors and the matches of the find bar start and end, so a match marks the
 * colored text under it. Both lists are in order and without overlaps.
 */
export function textParts(text: string, spans: LineSpans, found: readonly Range[]): TextPart[] {
    const cuts = new Set([0, text.length]);
    for (const [start, end] of [...spans, ...found]) {
        cuts.add(Math.min(start, text.length));
        cuts.add(Math.min(end, text.length));
    }
    const parts: TextPart[] = [];
    let span = 0;
    let match = 0;
    let start = 0;
    for (const end of [...cuts].sort((a, b) => a - b)) {
        if (end === start) continue;
        while ((spans[span]?.[1] ?? Number.POSITIVE_INFINITY) <= start) span++;
        while ((found[match]?.[1] ?? Number.POSITIVE_INFINITY) <= start) match++;
        const toned = spans[span];
        const inMatch = found[match];
        parts.push({
            text: text.slice(start, end),
            tone: toned && toned[0] <= start ? toned[2] : null,
            found: inMatch && inMatch[0] <= start ? match : null,
        });
        start = end;
    }
    return parts;
}
