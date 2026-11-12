import { type ReactNode, useMemo } from 'react';
import { useSyntaxColors } from '../../../../../application/queries/syntax-colors';
import type { DiffLine } from '../../../../../model/diff/diff-parser';
import { fileSides } from '../../../../../model/diff/sides';
import type { MarkdownCodeLine } from '../../../../../model/repository.types';
import { blocksOf, type LineSpans, textParts } from '../../../../../model/text/syntax';
import { TONE_CLASS } from '../../../text/syntax-tones';
import { usePreview } from '../preview-context';

/** The frame of a block of code: wrapped as the settings say, or scrolled sideways. */
export function CodeFrame({ children }: { children: ReactNode }) {
    const { wrap } = usePreview();
    return (
        <pre
            className={`rounded-lg bg-ui-surface px-4 py-3 font-mono text-[12.5px] leading-5 text-ui-syntax-text ${
                wrap ? 'whitespace-pre-wrap break-all' : 'overflow-x-auto'
            }`}
        >
            {children}
        </pre>
    );
}

/** A code block: the file's own lines, colored as the file is, from where the code starts. */
export function CodeBlock({ lines }: { lines: readonly MarkdownCodeLine[] }) {
    const { folderId, path } = usePreview();
    const sides = useMemo(() => fileSides(path), [path]);
    const asLines = useMemo(() => asDiffLines(lines), [lines]);
    const colorBlocks = useMemo(() => blocksOf(asLines, sides), [asLines, sides]);
    const colors = useSyntaxColors(folderId, sides, colorBlocks);
    return (
        <CodeFrame>
            <code>
                {asLines.map((line, index) => (
                    <div key={line.id} className="min-h-5">
                        <CodeText
                            text={line.text}
                            spans={colors.colorsOf(line) ?? []}
                            from={lines[index].from}
                        />
                    </div>
                ))}
            </code>
        </CodeFrame>
    );
}

/** The block's lines as a file's lines, unchanged, so the file's colors reach them. */
function asDiffLines(lines: readonly MarkdownCodeLine[]): DiffLine[] {
    return lines.map((line) => ({
        id: line.number,
        kind: 'context',
        text: line.text,
        oldNumber: line.number,
        newNumber: line.number,
    }));
}

/** A line's text from `from`, in its colors; a carriage return at its end left out. */
function CodeText({ text, spans, from }: { text: string; spans: LineSpans; from: number }) {
    const end = text.endsWith('\r') ? text.length - 1 : text.length;
    let at = 0;
    return textParts(text.slice(0, end), spans, []).map((part) => {
        const start = at;
        at += part.text.length;
        if (at <= from) return null;
        const shown = start < from ? part.text.slice(from - start) : part.text;
        const tone = part.tone ? TONE_CLASS[part.tone] : undefined;
        return tone ? (
            <span key={start} className={tone}>
                {shown}
            </span>
        ) : (
            shown
        );
    });
}
