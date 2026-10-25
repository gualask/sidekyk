import { describe, expect, it } from 'vitest';
import {
    blockAtLine,
    blocksById,
    fileSize,
    footnoteId,
    footnoteRefId,
    hasCodeAndPreview,
    kindKeys,
    previewKind,
    tableCells,
} from './preview';
import type { MarkdownBlock } from './repository.types';

const text = (value: string) => ({ kind: 'text' as const, text: value });

const DOCUMENT: MarkdownBlock[] = [
    { kind: 'heading', line: 1, level: 1, id: 'user-content-title', content: [text('Title')] },
    {
        kind: 'paragraph',
        line: 3,
        content: [text('See'), { kind: 'footnoteRef', number: 1, nth: 1 }],
    },
    {
        kind: 'list',
        line: 5,
        start: null,
        items: [
            {
                line: 5,
                task: null,
                blocks: [
                    {
                        kind: 'plain',
                        line: 5,
                        content: [{ kind: 'footnoteRef', number: 1, nth: 2 }],
                    },
                ],
            },
        ],
    },
    { kind: 'paragraph', line: 9, content: [text('More')] },
    {
        kind: 'footnotes',
        line: 7,
        notes: [{ number: 1, line: 7, references: 2, blocks: [] }],
    },
];

describe('previews', () => {
    it('are known by extension, case ignored', () => {
        expect(previewKind('docs/README.MD')).toBe('markdown');
        expect(previewKind('a.mkdn')).toBe('markdown');
        expect(previewKind('icons/logo.svg')).toBe('svg');
        expect(previewKind('shot.JPEG')).toBe('image');
        expect(previewKind('photo.avif')).toBeNull();
        expect(previewKind('.md')).toBeNull();
        expect(previewKind('src/main.ts')).toBeNull();
        expect(hasCodeAndPreview('a.svg')).toBe(true);
        expect(hasCodeAndPreview('a.png')).toBe(false);
    });

    it('key nodes by kind, so a block keeps its element when others change above it', () => {
        expect(kindKeys(DOCUMENT)).toEqual([
            'heading:0',
            'paragraph:0',
            'list:0',
            'paragraph:1',
            'footnotes:0',
        ]);
        const edited = [DOCUMENT[0], { kind: 'rule' as const, line: 2 }, ...DOCUMENT.slice(1)];
        expect(kindKeys(edited).slice(2)).toEqual(kindKeys(DOCUMENT).slice(1));
    });

    it('find the block of a line, the footnotes left out', () => {
        expect(blockAtLine(DOCUMENT, 1)).toBe(0);
        expect(blockAtLine(DOCUMENT, 4)).toBe(1);
        expect(blockAtLine(DOCUMENT, 7)).toBe(2);
        expect(blockAtLine(DOCUMENT, 100)).toBe(3);
    });

    it('find the block holding a heading, a footnote or a reference to it', () => {
        const ids = blocksById(DOCUMENT);
        expect(ids.get('user-content-title')).toBe(0);
        expect(ids.get(footnoteRefId(1, 1))).toBe(1);
        expect(ids.get(footnoteRefId(1, 2))).toBe(2);
        expect(ids.get(footnoteId(1))).toBe(4);
        expect(footnoteRefId(1, 2)).toBe('user-content-fnref-1-2');
    });

    it('key table cells by column and rows by place', () => {
        const table = tableCells([[text('a')], [text('b')]], [[[text('1')], []]], ['left']);
        expect(table.head.map((cell) => [cell.key, cell.align])).toEqual([
            ['column:0', 'left'],
            ['column:1', 'none'],
        ]);
        expect(table.rows[0].key).toBe('row:0');
        expect(table.rows[0].cells[1].content).toEqual([]);
    });

    it('size files as file managers do', () => {
        expect(fileSize(858, 'en-GB')).toBe('858 byte');
        expect(fileSize(7874, 'en-GB')).toBe('7.9 kB');
        expect(fileSize(16_777_216, 'it-IT')).toBe('16,8 MB');
    });
});
