import { describe, expect, it } from 'vitest';
import { formattingTotals } from './formatting';
import type { ChangedFile } from './repository.types';

function file(
    path: string,
    area: ChangedFile['area'],
    additions: number | null,
    deletions: number | null,
): ChangedFile {
    return {
        path,
        origPath: null,
        area,
        kind: area === 'untracked' ? 'untracked' : 'modified',
        additions,
        deletions,
        binary: additions === null,
    };
}

describe('formattingTotals', () => {
    const files = [
        file('crlf.ts', 'unstaged', 9, 9),
        file('indent.ts', 'unstaged', 4, 4),
        file('indent.ts', 'staged', 2, 1),
        file('real.ts', 'staged', 3, 1),
        file('new.ts', 'untracked', 40, 0),
        file('logo.png', 'staged', null, null),
    ];

    it('counts the lines git diff -w leaves out, a file it omits as all formatting', () => {
        const ignoring = {
            files: [
                { path: 'indent.ts', area: 'unstaged' as const, additions: 1, deletions: 1 },
                { path: 'indent.ts', area: 'staged' as const, additions: 2, deletions: 1 },
                { path: 'real.ts', area: 'staged' as const, additions: 3, deletions: 1 },
            ],
            truncated: false,
        };
        // untracked and binary files are not counted
        expect(formattingTotals(files, ignoring)).toEqual({
            lines: 18 + 6,
            changed: 18 + 8 + 3 + 4,
            files: 2,
            changedFiles: 3,
        });
    });

    it('tells nothing when the diff was cut', () => {
        expect(formattingTotals(files, { files: [], truncated: true })).toBeNull();
    });
});
