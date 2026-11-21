export const MAX_PAIRED_LENGTH = 1024;

export type ChangedRange = readonly [start: number, end: number];

const WORD = /\w/;
let graphemes: Intl.Segmenter | undefined;

/** One changed stretch in the displayed side, widened to the surrounding identifier or number. */
export function changedRange(text: string, other: string): ChangedRange | undefined {
    const [start, end] = widenedToWords(text, other, differingStretch(text, other));
    if (start === end) return undefined;
    // UTF-16 comparisons can stop inside an emoji or next to a combining mark.
    if (asciiEdges(text, start, end)) return [start, end];
    return wholeGraphemes(text, start, end);
}

/**
 * Where two texts stop sharing their start and their end: the stretch between, as `[start, end]`
 * in `text` and its end in `other`.
 */
function differingStretch(text: string, other: string): [number, number, number] {
    let start = 0;
    let end = text.length;
    let otherEnd = other.length;
    while (start < end && start < otherEnd && text.charCodeAt(start) === other.charCodeAt(start))
        start++;
    while (
        end > start &&
        otherEnd > start &&
        text.charCodeAt(end - 1) === other.charCodeAt(otherEnd - 1)
    ) {
        end--;
        otherEnd--;
    }
    return [start, end, otherEnd];
}

/**
 * The stretch grown over the letters, digits and underscores around it; an empty one by the
 * characters `other` has there, so a digit added at the end of a number also marks the number.
 */
function widenedToWords(
    text: string,
    other: string,
    [start, end, otherEnd]: [number, number, number],
): [number, number] {
    const first = start < end ? text.charAt(start) : other.charAt(start);
    const last = start < end ? text.charAt(end - 1) : other.charAt(otherEnd - 1);
    if (WORD.test(first)) while (start > 0 && WORD.test(text.charAt(start - 1))) start--;
    if (WORD.test(last)) while (end < text.length && WORD.test(text.charAt(end))) end++;
    return [start, end];
}

/** Whether the characters at and beside both ends of the stretch are ASCII (or none). */
function asciiEdges(text: string, start: number, end: number): boolean {
    return !(
        text.charCodeAt(start) >= 128 ||
        text.charCodeAt(start - 1) >= 128 ||
        text.charCodeAt(end) >= 128 ||
        text.charCodeAt(end - 1) >= 128
    );
}

/** The stretch grown to whole grapheme clusters; none where the engine cannot segment. */
function wholeGraphemes(text: string, start: number, end: number): ChangedRange | undefined {
    if (typeof Intl.Segmenter !== 'function') return undefined;
    graphemes ??= new Intl.Segmenter();
    const segments = graphemes.segment(text);
    const firstCluster = segments.containing(start);
    const lastCluster = segments.containing(end - 1);
    if (!firstCluster || !lastCluster) return [start, end];
    return [firstCluster.index, lastCluster.index + lastCluster.segment.length];
}
