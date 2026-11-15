/**
 * Where a query matched a text: UTF-16 offsets `[start, end)`. A text's highlights come in order,
 * apart. The backend's search sends them (`src-tauri/crates/core/src/modules/search/contracts.rs`).
 */
export type Highlight = [start: number, end: number];

/** A part of a text, where it starts in it, and whether the query matched it. */
export interface TextPart {
    text: string;
    start: number;
    matched: boolean;
}

/** A text cut into the parts the query matched and the parts between them. */
export function highlightParts(text: string, highlights: readonly Highlight[]): TextPart[] {
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
