import { describe, expect, it } from 'vitest';
import { entityParts, nameable, noteEntities, typingAt, withSuggestion } from './entities';

/** The entities of a text, each as the text it covers and where it points. */
function shown(text: string) {
    return noteEntities(text).map((entity) => {
        const covered = text.slice(entity.start, entity.end);
        if (entity.kind === 'link') return { covered, url: entity.url };
        return { covered, path: entity.path, lines: entity.lines };
    });
}

describe('note entities', () => {
    it('recognize a file after `@`, with or without a folder and an extension', () => {
        expect(shown('see @src/app/shell.tsx and @Makefile')).toEqual([
            { covered: '@src/app/shell.tsx', path: 'src/app/shell.tsx', lines: null },
            { covered: '@Makefile', path: 'Makefile', lines: null },
        ]);
    });

    it('recognize a path pasted without `@` only with a folder and an extension', () => {
        expect(shown('fails at src/app/shell.tsx:42 and/or v1.2 or 12/05/2026')).toEqual([
            {
                covered: 'src/app/shell.tsx:42',
                path: 'src/app/shell.tsx',
                lines: { first: 42, last: 42 },
            },
        ]);
        expect(shown('README.md alone')).toEqual([]);
    });

    it('read a line, a line and column, a range and GitHub lines', () => {
        const lines = (text: string) =>
            noteEntities(text).map((entity) => entity.kind === 'file' && entity.lines);
        expect(lines('@a.ts:7')).toEqual([{ first: 7, last: 7 }]);
        expect(lines('@a.ts:7:12')).toEqual([{ first: 7, last: 7 }]);
        expect(lines('@a.ts:7-12')).toEqual([{ first: 7, last: 12 }]);
        expect(lines('@a.ts:12-7')).toEqual([{ first: 7, last: 12 }]);
        expect(lines('src/a.ts#L3-L5')).toEqual([{ first: 3, last: 5 }]);
        expect(lines('@a.ts:0')).toEqual([null]);
    });

    it('leave out the brackets and punctuation around a reference', () => {
        expect(shown('(see `src/a.ts:3`), then @b/c.md.')).toEqual([
            { covered: 'src/a.ts:3', path: 'src/a.ts', lines: { first: 3, last: 3 } },
            { covered: '@b/c.md', path: 'b/c.md', lines: null },
        ]);
    });

    it('give a path with `/` between its parts, without a leading `./`', () => {
        expect(shown('src\\app\\main.rs ./docs/a.md')).toEqual([
            { covered: 'src\\app\\main.rs', path: 'src/app/main.rs', lines: null },
            { covered: './docs/a.md', path: 'docs/a.md', lines: null },
        ]);
    });

    it('leave out what only looks like a path: a clone address, abbreviations', () => {
        expect(shown('git clone git@github.com:org/repo.git, e.g./i.e. both')).toEqual([]);
    });

    it('name only paths a reference can hold whole', () => {
        expect(nameable('src/a.ts')).toBe(true);
        expect(nameable('docs/My File.md')).toBe(false);
    });

    it('never name a path outside the project', () => {
        expect(shown('@/etc/hosts @~/x.txt @../a.ts src/../../a.ts C:/a/b.ts @a//b.ts')).toEqual(
            [],
        );
    });

    it('recognize web addresses, a parenthesis they open kept', () => {
        expect(
            shown('docs at https://example.com/a?b=1, or (https://en.wikipedia.org/wiki/A_(b)).'),
        ).toEqual([
            { covered: 'https://example.com/a?b=1', url: 'https://example.com/a?b=1' },
            {
                covered: 'https://en.wikipedia.org/wiki/A_(b)',
                url: 'https://en.wikipedia.org/wiki/A_(b)',
            },
        ]);
        expect(shown('an email a@b.com, ftp://x/y.txt, http://')).toEqual([]);
    });

    it('give their offsets in the text, across lines', () => {
        const text = 'one\n  @a.ts:2\nhttps://x.dev';
        expect(noteEntities(text).map(({ start, end }) => [start, end])).toEqual([
            [6, 13],
            [14, 27],
        ]);
    });
});

describe('a note cut at its entities', () => {
    const text = 'see @a.ts then';
    const entities = noteEntities(text);

    it('gives the text around them and each by its index', () => {
        expect(entityParts(text, entities)).toEqual([
            { kind: 'text', start: 0, text: 'see ' },
            { kind: 'entity', start: 4, text: '@a.ts', entity: entities[0], index: 0 },
            { kind: 'text', start: 9, text: ' then' },
        ]);
    });

    it('marks where the `@` being typed is, in the text, at an entity or at the end', () => {
        expect(entityParts('a @b', [], 2)).toEqual([
            { kind: 'text', start: 0, text: 'a ' },
            { kind: 'anchor', start: 2 },
            { kind: 'text', start: 2, text: '@b' },
        ]);
        expect(entityParts(text, entities, 4).slice(1, 3)).toEqual([
            { kind: 'anchor', start: 4 },
            { kind: 'entity', start: 4, text: '@a.ts', entity: entities[0], index: 0 },
        ]);
        expect(entityParts('a ', [], 2).at(-1)).toEqual({ kind: 'anchor', start: 2 });
    });
});

describe('typing a file reference', () => {
    it('is a run starting with `@`, something typed after it', () => {
        expect(typingAt('see @src/ap', 11)).toEqual({ start: 4, end: 11, query: 'src/ap' });
        expect(typingAt('(@sh)', 4)).toEqual({ start: 1, end: 4, query: 'sh' });
        expect(typingAt('see @', 5)).toBeNull();
        expect(typingAt('a@b', 3)).toBeNull();
        expect(typingAt('see @a.ts:4', 11)).toBeNull();
    });

    it('covers the whole reference the caret is in', () => {
        expect(typingAt('@shell.tsx done', 3)).toEqual({ start: 0, end: 10, query: 'sh' });
    });

    it('is replaced by the file picked, a space after it', () => {
        const text = 'see @sh';
        const typing = typingAt(text, text.length);
        if (!typing) throw new Error('typing');
        expect(withSuggestion(text, typing, 'src/shell.tsx')).toEqual({
            text: 'see @src/shell.tsx ',
            caret: 19,
        });
    });

    it('keeps the space or the bracket that follows', () => {
        const spaced = 'see @sh now';
        const inWord = typingAt(spaced, 7);
        if (!inWord) throw new Error('typing');
        expect(withSuggestion(spaced, inWord, 'a.ts')).toEqual({
            text: 'see @a.ts now',
            caret: 10,
        });
        const bracketed = '(@sh)';
        const inBrackets = typingAt(bracketed, 4);
        if (!inBrackets) throw new Error('typing');
        expect(withSuggestion(bracketed, inBrackets, 'a.ts')).toEqual({
            text: '(@a.ts)',
            caret: 6,
        });
    });
});
