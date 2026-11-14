import { type ListChoice, listTarget, type MoveBook, type MoveState } from './destination';
import { type MarkHistory, markHistory, sameMarks } from './marks';
import {
    type CaptureImage,
    type CaptureInto,
    INBOX_BOOK,
    type ListTarget,
    type Mark,
    type Note,
    type NoteImage,
    type NoteList,
} from './notes.types';

/**
 * The capture window's draft (`docs/features/capture.md`): the crops of a note in the making, or
 * the images of a note there with crops added, each with its marks' history; the image selected,
 * the text, where it goes. Nothing is written until `↵`.
 */

/** A place a capture goes: a book and one of its lists (null: the one it opens on). */
export interface CapturePlace {
    book: string;
    list: string | null;
}

/** Where a draft goes: a place, a new note on top of its list, or a note there, fixed. */
export type DraftDestination =
    | { kind: 'place'; place: CapturePlace }
    | { kind: 'note'; book: string; note: string };

/** A crop just taken, as the backend holds it. */
export interface Crop {
    crop: string;
    width: number;
    height: number;
}

/** An image of the draft: a crop of its own, or one of the note's, with its marks' history. */
export type DraftImage =
    | ({ kind: 'crop'; history: MarkHistory } & Crop)
    | { kind: 'image'; image: NoteImage; history: MarkHistory };

export interface CaptureDraft {
    destination: DraftDestination;
    images: DraftImage[];
    /** The index of the image shown. */
    selected: number;
    text: string;
    /** The text it started with: a note's, else empty. */
    startText: string;
}

const NO_MARKS: Mark[] = [];

/**
 * Where a capture starts going: the place its entry names (a list, a note); else the place last
 * chosen for a capture this session; before any, the project on screen, on the list it opens on;
 * with none, the Inbox.
 */
export function initialDestination(
    into: CaptureInto,
    last: CapturePlace | null,
    onScreen: string | null,
): DraftDestination {
    if (into.kind === 'into') {
        const { book, target } = into;
        return target.kind === 'note'
            ? { kind: 'note', book, note: target.id }
            : { kind: 'place', place: { book, list: target.list } };
    }
    return { kind: 'place', place: last ?? { book: onScreen ?? INBOX_BOOK, list: null } };
}

/** A draft starting with `crop`, going to `destination`: with `note`'s images and text, if given. */
export function newDraft(
    destination: DraftDestination,
    note: Note | null,
    crop: Crop,
): CaptureDraft {
    const own: DraftImage[] = (note?.images ?? []).map((image) => ({
        kind: 'image',
        image,
        history: markHistory(image.marked?.marks ?? NO_MARKS),
    }));
    const text = note?.text ?? '';
    return withCrop({ destination, images: own, selected: 0, text, startText: text }, crop);
}

/** The draft with `crop` after its images, selected. */
export function withCrop(draft: CaptureDraft, crop: Crop): CaptureDraft {
    const image: DraftImage = { kind: 'crop', ...crop, history: markHistory(NO_MARKS) };
    const images = [...draft.images, image];
    return { ...draft, images, selected: images.length - 1 };
}

/**
 * The draft without its crop at `index`, the selection kept on the image it was on (the one
 * before, when it was this one). A note's own images, and a new note's last crop, stay.
 */
export function withoutCrop(draft: CaptureDraft, index: number): CaptureDraft {
    if (!canRemove(draft, index)) return draft;
    const images = draft.images.filter((_, at) => at !== index);
    const selected =
        draft.selected > index || (draft.selected === index && index === images.length)
            ? draft.selected - 1
            : draft.selected;
    return { ...draft, images, selected: Math.max(0, selected) };
}

/** Whether the image at `index` can be taken out: a crop, unless a new note's only one. */
export function canRemove(draft: CaptureDraft, index: number): boolean {
    const crops = draft.images.filter((image) => image.kind === 'crop').length;
    const alone = draft.destination.kind === 'place' && crops === 1;
    return draft.images[index]?.kind === 'crop' && !alone;
}

/** The draft with `step` images further on (`-1` before), round. */
export function steppedTo(draft: CaptureDraft, step: number): CaptureDraft {
    const count = draft.images.length;
    return { ...draft, selected: (draft.selected + step + count) % count };
}

/** The draft with the image at `index`'s marks changed. */
export function withHistory(
    draft: CaptureDraft,
    index: number,
    change: (history: MarkHistory) => MarkHistory,
): CaptureDraft {
    const images = draft.images.map((image, at) =>
        at === index ? { ...image, history: change(image.history) } : image,
    );
    return { ...draft, images };
}

/** The crops the draft holds; none without a draft. */
export function draftCrops(draft: CaptureDraft | null): string[] {
    return (draft?.images ?? []).flatMap((image) => (image.kind === 'crop' ? [image.crop] : []));
}

/** Whether a note's image has marks other than those it came with. */
function remarked(image: Extract<DraftImage, { kind: 'image' }>): boolean {
    return !sameMarks(image.history.present, image.image.marked?.marks ?? NO_MARKS);
}

/** Whether discarding the draft loses something: marks placed, or text changed. */
export function draftChanged(draft: CaptureDraft): boolean {
    const marked = draft.images.some((image) =>
        image.kind === 'crop' ? image.history.present.length > 0 : remarked(image),
    );
    return marked || draft.text !== draft.startText;
}

/**
 * The images the draft writes, in order, without their PNGs: every crop, and the note's images
 * whose marks changed.
 */
export function draftImages(draft: CaptureDraft): CaptureImage[] {
    return draft.images.flatMap((image): CaptureImage[] => {
        const marks = image.history.present;
        if (image.kind === 'crop') return [{ kind: 'crop', crop: image.crop, marks, drawn: null }];
        return remarked(image) ? [{ kind: 'image', id: image.image.id, marks, drawn: null }] : [];
    });
}

/** The text the draft writes: a new note's, or a note's when it changed (else none). */
export function draftText(draft: CaptureDraft): string | null {
    if (draft.destination.kind === 'place') return draft.text;
    return draft.text === draft.startText ? null : draft.text;
}

/** Where focus is in the capture window. */
export type CaptureFocus = 'image' | 'text';

/** What `↵` does: the selected mark's text written, the note written (and copied), a new line. */
export type EnterAction = 'markText' | 'write' | 'writeAndCopy' | 'newLine';

/**
 * What `↵` does where the focus is: `⌘↵` writes and copies anywhere; on the image, with a mark
 * selected it writes its text, else the note; in the text, `⇧↵` a new line, else the note.
 */
export function enterAction(
    focus: CaptureFocus,
    { selected, shift, mod }: { selected: boolean; shift: boolean; mod: boolean },
): EnterAction {
    if (mod) return 'writeAndCopy';
    if (focus === 'image') return selected ? 'markText' : 'write';
    return shift ? 'newLine' : 'write';
}

/**
 * The destination field's chips for `place`: its book, and a project's list once the lists are
 * read (the Inbox's one list is never a chip).
 */
export function placeState(
    place: CapturePlace,
    books: readonly MoveBook[],
    lists: readonly NoteList[] | undefined,
): MoveState {
    const chip = books.find((book) => book.book === place.book) ?? null;
    const list =
        place.book === INBOX_BOOK ? undefined : lists?.find((list) => list.id === place.list);
    const choice: ListChoice | null = chip && list ? { kind: 'list', list } : null;
    return { chip, list: choice, query: '' };
}

/** Where the field's chips send a new note: a book and a list of it; none without a book. */
export function chipsPlace(state: MoveState): { book: string; list: ListTarget } | null {
    if (!state.chip) return null;
    return { book: state.chip.book, list: listTarget(state.list) };
}
