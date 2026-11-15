/**
 * A text's lines: a `\n` at its end ends the last line rather than starting an empty one, and an
 * empty text has none. A CRLF line keeps its `\r`, which a diff tells as a line end apart.
 */
export function splitLines(text: string): string[] {
    const lines = text.split('\n');
    if (lines.at(-1) === '') lines.pop();
    return lines;
}
