/** Fixed heights, so the virtualized diff knows every row's place without measuring it. */
export const HUNK_ROW_HEIGHT = 24;
export const LINE_ROW_HEIGHT = 20;

/** The gutters and padding around a line's text, in pixels; matches `DiffLineRow`. */
export const LINE_CHROME_WIDTH = 48 + 48 + 20 + 4 + 24;
