import { highlightParts, type Matched } from '../format/highlight-parts';

/** A text ranked against a query, the letters it matched in bold: the palette's, a note's `@`. */
export function MatchedText({
    text,
    highlights,
    className,
}: {
    text: string;
    highlights: Matched;
    className: string;
}) {
    return (
        <span className={className}>
            {highlightParts(text, highlights).map((part) =>
                part.matched ? (
                    <mark key={part.start} className="bg-transparent font-bold text-current">
                        {part.text}
                    </mark>
                ) : (
                    <span key={part.start}>{part.text}</span>
                ),
            )}
        </span>
    );
}
