import {
    type ImageTarget,
    INBOX_BOOK,
    imageFile,
    type MovedList,
    type Note,
    type NoteImage,
    type NotesPort,
    openNotes,
    type ProjectNotes,
    positionAt,
    sourceImage,
} from '@/modules/notes';
import { type FixtureCapturePort, fixtureCapture } from './capture.fixture';
import {
    absorb,
    addedNote,
    type Book,
    listOf,
    noteOf,
    putList,
    removeList,
    replace,
    snapshot,
    takeList,
    takeOut,
    targetList,
} from './note-books.fixture';
import { fixtureNoteImages, onBrowserImageDrop } from './note-images.fixture';
import { initialNotes } from './notes.fixture-data';
import type { FixtureProjects } from './projects';
import { failure, newId, type Scenario } from './scenario';

/** The notes port, and what the other fixtures read of it. */
export type FixtureNotes = NotesPort & {
    peek: (book: string) => ProjectNotes;
    drop: (book: string) => void;
    merge: (from: string, into: string, label: string) => void;
};

/**
 * Notes in memory, as the backend keeps them (`src-tauri/crates/core/src/modules/notes/store/`):
 * each book starts with the scenario's notes (`initialNotes`). As the backend, a book is the Inbox
 * or a project in the list, not its repository: a moved one's notes stay. `onTaken` opens the
 * capture window on an area taken.
 */
export function fixtureNotes(
    scenario: Scenario,
    projects: FixtureProjects,
    onTaken: (width: number, height: number) => void,
): FixtureNotes {
    const images = fixtureNoteImages();
    const books = new Map<string, Book>();
    const book = (key: string): Book => {
        if (key !== INBOX_BOOK) projects.project(key);
        let found = books.get(key);
        if (!found) {
            found = initialNotes(scenario, key, images);
            books.set(key, found);
        }
        return found;
    };
    // as the store's `project_only`: the Inbox has one list, never changed, and no done
    const projectBook = (key: string) => {
        if (key === INBOX_BOOK) throw failure('unknown');
        return book(key);
    };
    /** As the backend's `add_images`: the image read, in the note given or a new one. */
    const addImage: NotesPort['addImage'] = async (key, target: ImageTarget, bytes) => {
        const b = book(key);
        const image = await images.read(bytes);
        const found = target.kind === 'note' ? noteOf(b, target.id) : addedNote(b, target.list, '');
        found.images = [...found.images, image];
        found.edited = Date.now();
        return { ...found };
    };
    const port: Omit<FixtureNotes, keyof FixtureCapturePort> = {
        /** The notes as they are, for the palette's search. */
        peek: (key) => snapshot(book(key)),
        /** A project removed takes its notes, as the backend's `remove_project`. */
        drop: (key) => {
            books.delete(key);
        },
        /**
         * A project merged into another moves its notes there, as the backend's `merge_book`:
         * each list with notes, named after the project merged (`label`) when the other has its
         * name; then its book goes.
         */
        merge: (from, into, label) => {
            const source = projectBook(from);
            const dest = projectBook(into);
            for (const list of source.lists) {
                const notes = source.notes.filter((n) => n.list === list.id);
                if (notes.length === 0) continue;
                const lower = list.name.toLowerCase();
                const taken = dest.lists.some((l) => l.name.toLowerCase() === lower);
                absorb(dest, taken ? `${list.name} (${label})` : list.name, notes);
            }
            books.delete(from);
        },
        getNotes: async (key) => snapshot(book(key)),
        addNote: async (key, listId, text) => ({ ...addedNote(book(key), listId, text) }),
        // as the backend, without renumbering: positions here never run out of room
        setNoteText: async (key, id, text) => {
            const found = noteOf(book(key), id);
            if (found.text !== text) {
                found.text = text;
                found.edited = Date.now();
            }
            return { ...found };
        },
        setNoteDone: async (key, id, done) => {
            const found = noteOf(projectBook(key), id);
            if ((found.done !== null) !== done) found.done = done ? Date.now() : null;
            return { ...found };
        },
        placeNote: async (key, id, listId, index) => {
            const b = projectBook(key);
            listOf(b, listId);
            const moved = noteOf(b, id);
            moved.position = positionAt(openNotes(b.notes, listId), id, index);
            moved.list = listId;
            return [{ ...moved }];
        },
        restoreNote: async (key, restored) => {
            const b = book(key);
            listOf(b, restored.list);
            replace(b, restored);
            return { ...restored };
        },
        deleteNote: async (key, id) => {
            const b = book(key);
            noteOf(b, id);
            takeOut(b, id);
        },
        moveNote: async (from, id, key, target) => {
            const inbox = key === INBOX_BOOK;
            if (inbox && target.kind !== 'open') throw failure('unknown');
            const source = book(from);
            const dest = book(key);
            const moved = noteOf(source, id);
            const listId = targetList(dest, target);
            const placed: Note = {
                ...moved,
                list: listId,
                position: positionAt(openNotes(dest.notes, listId), id, 0),
                done: inbox ? null : moved.done,
            };
            takeOut(source, id);
            replace(dest, placed);
            return { to: key, note: { ...placed } };
        },
        unmoveNote: async (at, original, home) => {
            const back = book(home);
            listOf(back, original.list);
            takeOut(book(at), original.id);
            replace(back, original);
            return { ...original };
        },
        moveList: async (from, listId, key) => {
            const source = projectBook(from);
            const dest = projectBook(key);
            const left = takeList(source, listId);
            const result: MovedList = {
                from,
                to: key,
                left,
                ...absorb(dest, left.list.name, left.notes),
            };
            return result;
        },
        unmoveList: async (moved) => {
            const source = projectBook(moved.from);
            const dest = projectBook(moved.to);
            putList(source, moved.left);
            for (const back of moved.left.notes) takeOut(dest, back.id);
            const empty = !dest.notes.some((n) => n.list === moved.into);
            if (!moved.joined && empty && dest.lists.length > 1) removeList(dest, moved.into);
        },
        addList: async (key, name) => {
            const b = projectBook(key);
            const added = { id: newId(), name: name.trim() };
            b.lists.push(added);
            b.openList = added.id;
            return { ...added };
        },
        renameList: async (key, id, name) => {
            const found = listOf(projectBook(key), id);
            found.name = name.trim();
            return { ...found };
        },
        deleteList: async (key, id) => takeList(projectBook(key), id),
        restoreList: async (key, deleted) => {
            const b = projectBook(key);
            putList(b, deleted);
            return snapshot(b);
        },
        // as the backend's `NoteBook::count`
        countNotes: async (key) => {
            const { notes } = book(key);
            const open = notes.filter((n) => n.done === null).length;
            return { open, done: notes.length - open };
        },
        // as if saved where the dialog first offers
        exportNotes: async (projectId) => {
            projectBook(projectId);
            return '/Users/dev/Documents/notes.md';
        },
        openList: async (key, id) => {
            const b = projectBook(key);
            listOf(b, id);
            b.openList = id;
        },
        addImage,
        // as the backend's `mark_image`: the drawn PNG under a new id, the image as given kept
        markImage: async (key, id, image, marks, drawn) => {
            const found = noteOf(book(key), id);
            const index = found.images.findIndex((i) => i.id === image);
            if (index < 0) throw failure('unknown');
            const current = found.images[index];
            const given = sourceImage(current);
            const source = { id: given.id, kind: given.kind, bytes: given.bytes };
            let replacement: NoteImage;
            if (marks.length === 0) {
                replacement = given;
            } else {
                if (!drawn) throw failure('unknown');
                replacement = {
                    ...current,
                    id: images.drawn(drawn),
                    kind: 'png',
                    bytes: drawn.length,
                    marked: { source, marks },
                };
            }
            found.images = found.images.map((i, at) => (at === index ? replacement : i));
            found.edited = Date.now();
            return { ...found };
        },
        removeImage: async (key, id, image) => {
            const found = noteOf(book(key), id);
            found.images = found.images.filter((i) => i.id !== image);
            found.edited = Date.now();
            return { ...found };
        },
        // as the backend's `copy_text`, the images where a Mac would keep them
        copyNote: async (key, id) => {
            const found = noteOf(book(key), id);
            if (found.images.length === 0) return found.text;
            const paths = found.images
                .map(
                    (i) =>
                        `/Users/dev/Library/Application Support/sidekyk/notes/${key}/${imageFile(i, false)}`,
                )
                .join('\n');
            const text = found.text.trimEnd();
            return text === '' ? paths : `${text}\n\n${paths}`;
        },
        imagePng: async (_key, image) => (await fetch(images.url(image.id))).blob(),
        imageUrl: (_key, image) => images.url(image.id),
        onImageDrop: (listener) => onBrowserImageDrop(addImage, listener),
    };
    const capture = fixtureCapture({ ...port, note: (key, id) => noteOf(book(key), id) }, onTaken);
    return { ...port, ...capture };
}
