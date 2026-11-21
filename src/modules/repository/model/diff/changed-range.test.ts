import { describe, expect, it } from 'vitest';
import { changedRange } from './changed-range';
import { parseUnifiedDiff } from './diff-parser';

describe('changed ranges of a replacement', () => {
    it.each([
        ['call(3000)', 'call(30000)', '3000', '30000'],
        ['if (a >= b)', 'if (a > b)', '=', undefined],
        ['call(userId)', 'call(orderId)', 'userId', 'orderId'],
        ['x = 1 + y + 2', 'x = 3 + y + 4', '1 + y + 2', '3 + y + 4'],
        ['icon("👩‍💻")', 'icon("👩‍🔬")', '👩‍💻', '👩‍🔬'],
        ['"a\u0300"', '"a\u0301"', 'a\u0300', 'a\u0301'],
    ])('marks the changed text of %s and %s', (old, now, removed, added) => {
        function marked(text: string, other: string) {
            const range = changedRange(text, other);
            return range && text.slice(...range);
        }
        expect(marked(old, now)).toEqual(removed);
        expect(marked(now, old)).toEqual(added);
    });

    it('only offers short paired lines with a content change to the viewer', () => {
        const short = 'x'.repeat(1024);
        const long = `${short}x`;
        const diff = [
            '@@ -1,6 +1,7 @@',
            '-foo',
            '-a b',
            '-x',
            `-${short}`,
            '+bar',
            '+ab',
            `+${long}`,
            '+y',
            ' context',
            '-m',
            '+n',
            '+o',
        ].join('\n');
        const lines = parseUnifiedDiff(diff).hunks[0]?.lines ?? [];
        expect(
            lines
                .filter((line) => line.pairedText !== undefined)
                .map((line) => [line.text, line.pairedText]),
        ).toEqual([
            ['foo', 'bar'],
            [short, 'y'],
            ['bar', 'foo'],
            ['y', short],
        ]);
    });
});
