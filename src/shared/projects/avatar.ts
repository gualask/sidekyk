import type { ProjectInfo } from './project-info';

/**
 * How many avatar colors there are: `--ui-avatar-1` to `--ui-avatar-10` in the theme
 * (`AVATAR_COLORS` in `src-tauri/crates/core/src/modules/projects/avatar.rs`).
 */
export const AVATAR_COLORS = 10;

/** The color an avatar shows in. */
export function avatarColor(color: number): string {
    return `var(--ui-avatar-${color})`;
}

/** What an avatar shows: the letters the user wrote, else the name's, capitalized. */
export function avatarLetters(project: Pick<ProjectInfo, 'name' | 'avatar'>): string {
    return (project.avatar.letters ?? nameLetters(project.name)).toLocaleUpperCase();
}

/** A run of letters and digits: a name's word. */
const WORD = /[\p{Alphabetic}\p{N}]+/gu;

/**
 * The letters a name gives: the first of its first and last words (`my-shop-api` MA), else a
 * word's first letter and the capital starting its second hump (`SideKyk` SK), else its first
 * letter (`shop` S).
 */
export function nameLetters(name: string): string {
    const [first, ...others] = name.match(WORD) ?? [];
    if (first === undefined) return firstChar(name.trim()) || '?';
    const last = others.at(-1);
    return last === undefined ? humps(first) : firstChar(first) + firstChar(last);
}

function firstChar(text: string): string {
    return Array.from(text)[0] ?? '';
}

/** A word's first letter, and the first capital after a small letter (`iOS` iO, `README` R). */
function humps(word: string): string {
    const chars = Array.from(word);
    const hump = chars.findIndex((char, i) => i > 0 && isUpper(char) && isLower(chars[i - 1]));
    return hump > 0 ? chars[0] + chars[hump] : chars[0];
}

function isUpper(char: string): boolean {
    return char !== char.toLocaleLowerCase() && char === char.toLocaleUpperCase();
}

function isLower(char: string): boolean {
    return char !== char.toLocaleUpperCase();
}
