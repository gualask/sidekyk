import { type FileVersion, lineCheck, type SyntaxColors } from '@/modules/repository';

/** What the fixtures serve, to find a version's text in. */
export interface FixtureTexts {
    /** A working-tree change's diff with every line, by area and path. */
    changeDiff: (area: 'staged' | 'unstaged' | 'untracked', path: string) => string | null;
    /** The text of a file of the tree. */
    fileText: (path: string) => string | null;
    /** A commit's diff with every line, of the file now at `path`, or once at it before a rename. */
    commitDiff: (sha: string, path: string) => { text: string; side: 'old' | 'new' } | null;
}

/** One side of a diff with every line as context: the old file, or the new one. */
function sideOf(diff: string, side: 'old' | 'new'): string {
    const lines = diff.split('\n');
    const start = lines.findIndex((line) => line.startsWith('@@'));
    if (start < 0) return '';
    const skipped = side === 'old' ? '+' : '-';
    return lines
        .slice(start + 1)
        .filter((line) => !line.startsWith(skipped) && !line.startsWith('\\'))
        .map((line) => line.slice(1))
        .join('\n');
}

/** The text of a version, from the diffs and files the fixtures serve: null when there is none. */
export function fixtureVersionText(
    texts: FixtureTexts,
    path: string,
    version: FileVersion,
): string | null {
    const worktree = () => {
        const changed = texts.changeDiff('unstaged', path) ?? texts.changeDiff('untracked', path);
        return changed ? sideOf(changed, 'new') : texts.fileText(path);
    };
    const unstaged = texts.changeDiff('unstaged', path);
    const staged = texts.changeDiff('staged', path);
    switch (version.kind) {
        case 'worktree':
            return worktree();
        case 'index':
            if (staged) return sideOf(staged, 'new');
            return unstaged ? sideOf(unstaged, 'old') : worktree();
        case 'head':
            if (staged) return sideOf(staged, 'old');
            return unstaged ? sideOf(unstaged, 'old') : worktree();
        case 'commit': {
            const found = texts.commitDiff(version.sha, path);
            return found ? sideOf(found.text, found.side) : null;
        }
    }
}

/** A few tones by pattern, enough to see colors in the fixtures; the app's come from grammars. */
const TOKENS =
    /(\/\/.*$)|('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`)|\b(import|export|from|const|let|var|function|return|if|else|for|while|new|type|interface|class|extends|async|await|throw|try|catch|of|in)\b|\b(\d+(?:\.\d+)?|true|false|null|undefined)\b|\b([A-Z][A-Za-z0-9]*)\b|\b([a-z_$][\w$]*)(?=\()/g;

const TOKEN_TONES = ['comment', 'string', 'keyword', 'literal', 'type', 'function'] as const;

function spansOf(line: string): SyntaxColors['lines'][number]['spans'] {
    const spans: SyntaxColors['lines'][number]['spans'] = [];
    for (const match of line.matchAll(TOKENS)) {
        const group = match.slice(1).findIndex((part) => part !== undefined);
        const tone = TOKEN_TONES[group];
        if (tone) spans.push([match.index, match.index + match[0].length, tone]);
    }
    return spans;
}

/** As the backend answers: a block of lines of a text, colored. */
export function fixtureColors(text: string | null, first: number, count: number): SyntaxColors {
    if (text === null) return { tooLarge: false, lines: [] };
    const lines = text.split('\n');
    if (lines.at(-1) === '') lines.pop();
    return {
        tooLarge: false,
        lines: lines
            .slice(first - 1, first - 1 + count)
            .map((line) => ({ check: lineCheck(line), spans: spansOf(line) })),
    };
}
