/** Where a query matched a text: UTF-16 offsets `[start, end)`, in order, apart. */
export type Matched = readonly (readonly [start: number, end: number])[];

/** A part of a text, where it starts in it, and whether the query matched it. */
export interface TextPart {
    text: string;
    start: number;
    matched: boolean;
}

/** A text cut into the parts the query matched and the parts between them. */
export function highlightParts(text: string, highlights: Matched): TextPart[] {
    const parts: TextPart[] = [];
    let at = 0;
    for (const [start, end] of highlights) {
        if (start > at) parts.push({ text: text.slice(at, start), start: at, matched: false });
        parts.push({ text: text.slice(start, end), start, matched: true });
        at = end;
    }
    if (at < text.length) parts.push({ text: text.slice(at), start: at, matched: false });
    return parts;
}
