/**
 * Parts of a note's text that point somewhere, recognized from the text alone, offline: the same
 * text always gives the same parts (`docs/features/note-references.md`). They stay in the text,
 * which is what a copy gives an agent or a colleague.
 */

/** Lines of a file, `first` to `last` included, by their numbers in it. */
export interface NamedLines {
    first: number;
    last: number;
}

/** A part of a note's text, `[start, end)` in UTF-16 offsets, and where it points. */
export type NoteEntity =
    | {
          kind: 'file';
          start: number;
          end: number;
          /** Relative to the folder, `/` between its parts, without a leading `./`. */
          path: string;
          lines: NamedLines | null;
      }
    | { kind: 'link'; start: number; end: number; url: string };

/** What may come before a reference, not part of it: `(src/a.ts)`, `"https://…"`. */
const OPENERS = new Set(['(', '[', '{', '<', '"', "'", '`', '*']);
/** What may come after one, not part of it: the end of a sentence, a closing bracket. */
const CLOSERS = new Set(['.', ',', ';', ':', '!', '?', ')', ']', '}', '>', '"', "'", '`', '*']);

const WEB = /^https?:\/\/\S/i;
/** A line, a line and its column (`:42:7`), or lines (`:42-50`); GitHub's `#L42-L50` too. */
const LOCATION = /(?::(\d+)(?:([-:])(\d+))?|#L(\d+)(?:-L?(\d+))?)$/;
/** The last part of a path as a file has it, with an extension. */
const FILE_NAME = /\.[A-Za-z][A-Za-z0-9_-]{0,11}$/;
/**
 * Characters no path of a project holds, as a reference writes it; a colon past the lines is an
 * address (`git@github.com:org/repo.git`) or a drive, not a path of the project.
 */
const NOT_IN_PATH = /[<>"|?*`:]/;

/** The parts of `text` that point at a file of the project or at a web address, in order. */
export function noteEntities(text: string): NoteEntity[] {
    const found: NoteEntity[] = [];
    for (const match of text.matchAll(/\S+/g)) {
        const entity = entityIn(match[0], match.index);
        if (entity) found.push(entity);
    }
    return found;
}

/** The entity a run of text without spaces is, the brackets and punctuation around it left out. */
function entityIn(word: string, at: number): NoteEntity | null {
    let start = 0;
    let end = word.length;
    while (start < end && OPENERS.has(word.charAt(start))) start += 1;
    while (end > start && CLOSERS.has(word.charAt(end - 1))) {
        // a closing parenthesis an address opened is its own: Wikipedia's `…_(disambiguation)`
        if (word.charAt(end - 1) === ')' && opens(word.slice(start, end - 1))) break;
        end -= 1;
    }
    const part = word.slice(start, end);
    if (part === '') return null;
    if (WEB.test(part)) return { kind: 'link', start: at + start, end: at + end, url: part };
    const named = part.startsWith('@');
    const file = fileIn(named ? part.slice(1) : part, named);
    return file ? { kind: 'file', start: at + start, end: at + end, ...file } : null;
}

/** Whether a text opens more parentheses than it closes. */
function opens(text: string): boolean {
    let depth = 0;
    for (const char of text) {
        if (char === '(') depth += 1;
        else if (char === ')') depth -= 1;
    }
    return depth > 0;
}

/**
 * The file and lines a reference names: after `@` any path of the project (`@Makefile`); without
 * it, only one with a folder and an extension (`src/app.ts:42`), so that `and/or` or `v1.2` are
 * not. Never a path outside the project: absolute, from home, or through `..`.
 */
function fileIn(text: string, named: boolean): { path: string; lines: NamedLines | null } | null {
    const location = LOCATION.exec(text);
    const raw = location ? text.slice(0, location.index) : text;
    const path = raw.replaceAll('\\', '/').replace(/^(\.\/)+/, '');
    if (path === '' || NOT_IN_PATH.test(path) || path.includes('://')) return null;
    if (path.startsWith('/') || path.startsWith('~') || /^[A-Za-z]:/.test(path)) return null;
    const parts = path.split('/');
    // a part ending with a dot is prose (`e.g./i.e.`), not a folder or a file
    if (parts.some((part) => part === '' || part.endsWith('.'))) return null;
    if (!named && (parts.length < 2 || !FILE_NAME.test(parts.at(-1) ?? ''))) return null;
    return { path, lines: location ? linesOf(location) : null };
}

/** The lines a location names; a column names its line alone. */
function linesOf(location: RegExpExecArray): NamedLines | null {
    const [, line, separator, other, githubLine, githubOther] = location;
    const first = Number(line ?? githubLine);
    const second = separator === ':' ? undefined : (other ?? githubOther);
    const last = second === undefined ? first : Number(second);
    if (!(first > 0)) return null;
    return { first: Math.min(first, last), last: Math.max(first, last) };
}

/** A part of a note's text: plain, an entity and its index, or where the `@` being typed is. */
export type EntityPart =
    | { kind: 'text'; start: number; text: string }
    | { kind: 'entity'; start: number; text: string; entity: NoteEntity; index: number }
    | { kind: 'anchor'; start: number };

/**
 * A note's text cut at its entities, in order, as a card shows it and the field's tint draws it;
 * with `anchor`, a mark at that offset, before what starts there.
 */
export function entityParts(
    text: string,
    entities: readonly NoteEntity[],
    anchor: number | null = null,
): EntityPart[] {
    const parts: EntityPart[] = [];
    let at = 0;
    // the text up to `end`, the mark among it
    const plain = (end: number) => {
        if (anchor !== null && anchor >= at && anchor < end) {
            if (anchor > at) parts.push({ kind: 'text', start: at, text: text.slice(at, anchor) });
            parts.push({ kind: 'anchor', start: anchor });
            at = anchor;
        }
        if (end > at) parts.push({ kind: 'text', start: at, text: text.slice(at, end) });
        at = end;
    };
    entities.forEach((entity, index) => {
        plain(entity.start);
        if (anchor === entity.start) parts.push({ kind: 'anchor', start: anchor });
        parts.push({
            kind: 'entity',
            start: entity.start,
            text: text.slice(entity.start, entity.end),
            entity,
            index,
        });
        at = entity.end;
    });
    plain(text.length);
    if (anchor === text.length) parts.push({ kind: 'anchor', start: anchor });
    return parts;
}

/**
 * Whether a reference can name the file at `path` as it is: a path with a space would end the
 * reference there (`@docs/My File.md` reads as `@docs/My`).
 */
export function nameable(path: string): boolean {
    return !/\s/.test(path);
}

/** The `@` being typed at the caret: where it starts and ends, and what follows it so far. */
export interface Typing {
    /** The `@`'s offset. */
    start: number;
    /** The end of the reference the caret is in, which a suggestion replaces whole. */
    end: number;
    query: string;
}

/**
 * The file reference being typed at `caret`, if any: a run without spaces that starts with `@`
 * (after an opening bracket or quote, if any), with something typed after it up to the caret.
 * None once a line is typed (`:42`), which ends the path.
 */
export function typingAt(text: string, caret: number): Typing | null {
    let start = caret;
    while (start > 0 && !/\s/.test(text.charAt(start - 1))) start -= 1;
    while (start < caret && OPENERS.has(text.charAt(start))) start += 1;
    if (text.charAt(start) !== '@') return null;
    const query = text.slice(start + 1, caret);
    if (query === '' || /[:#]/.test(query)) return null;
    let end = caret;
    while (end < text.length && !/\s/.test(text.charAt(end))) end += 1;
    while (end > caret && CLOSERS.has(text.charAt(end - 1))) end -= 1;
    return { start, end, query };
}

/**
 * The text with the reference being typed replaced by `@path` and the caret past it, then past
 * the space after it, which is added unless one follows already; before a closing bracket or
 * punctuation that follows, without a space.
 */
export function withSuggestion(
    text: string,
    typing: Typing,
    path: string,
): { text: string; caret: number } {
    const after = text.slice(typing.end);
    const reference = `@${path}`;
    const caret = typing.start + reference.length;
    const next = after.charAt(0);
    if (CLOSERS.has(next)) return { text: text.slice(0, typing.start) + reference + after, caret };
    const space = /\s/.test(next) ? '' : ' ';
    return { text: text.slice(0, typing.start) + reference + space + after, caret: caret + 1 };
}
