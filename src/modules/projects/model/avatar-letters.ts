/** One or two letters or digits, as the backend's `valid_letters`. */
const LETTERS = /^[\p{Alphabetic}\p{N}]{1,2}$/u;

/** Letters the user wrote, trimmed: null for none (the name's), false when they cannot show. */
export function writtenLetters(text: string): string | null | false {
    const letters = text.trim();
    if (letters === '') return null;
    return LETTERS.test(letters) ? letters : false;
}
