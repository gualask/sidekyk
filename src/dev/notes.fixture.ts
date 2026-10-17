import {
    type DeletedList,
    type Note,
    type NoteList,
    type NotesPort,
    noteTitle,
    openNotes,
    type ProjectNotes,
    positionAt,
} from '@/modules/notes';

/** A native command's failure, as the backend sends it. */
function failure(code: string) {
    return { code, message: code };
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const LONG_ANSWER = `Here is how I would restructure the watcher, step by step.

1. Keep one watcher per repository, but coalesce events per directory instead of per file. During a checkout of 2,000 files that is a few dozen events instead of thousands.
2. Drop events for ignored paths before they reach the coalescer: today they are filtered after, so they still wake the thread.
3. Debounce at 120 ms, not 300: the snapshot itself takes 40 ms on the large fixture, so the user waits less and the CPU cost is the same.
4. On macOS, FSEvents already batches; the extra timer only matters on Linux and Windows.

What I would not change:
- the snapshot itself, it is already bounded;
- the lock-free status calls (GIT_OPTIONAL_LOCKS=0).

If you want, I can measure steps 1 and 2 with backend_timings before touching anything.`;

/** The notes of the scenario's project, as in the approved mock: [list, text, age, done age]. */
const REVIEW_NOTES: [string, string, number, number | null][] = [
    [
        'General',
        'Palette with 10k files: does it stay under 16 ms per keystroke?',
        20 * MINUTE,
        null,
    ],
    ['General', 'Esc inside a note should leave the note, not zoom out', 26 * HOUR, null],
    [
        'General',
        'Golden rule: measure before and after, nothing runs while idle, every dependency is discussed first',
        2 * DAY,
        null,
    ],
    ['General', 'Wide scrollbar setting', 3 * DAY, DAY],
    ['General', 'Try the project rail against the overview for switching', 4 * DAY, 2 * DAY],
    [
        'Architecture',
        '"Coalescing events per directory instead of per file would cut wakeups during a large checkout, at the cost of one extra status call."',
        3 * HOUR,
        null,
    ],
    ['Architecture', LONG_ANSWER, 5 * HOUR, null],
    [
        'Architecture',
        'Panels as modules behind one contract: app composes them, modules never import each other',
        6 * DAY,
        null,
    ],
    [
        'Observability',
        'Log the snapshot duration at debug, not info: it runs on every change',
        40 * MINUTE,
        null,
    ],
    [
        'Observability',
        'One span per git command, with its exit code and how long it took',
        2 * HOUR,
        null,
    ],
];

let seq = 0;
/** 16 hex digits, as the backend's ids. */
function newId(): string {
    seq += 1;
    return (Date.now() * 1000 + seq).toString(16).padStart(16, '0').slice(-16);
}

interface Book {
    lists: NoteList[];
    notes: Note[];
    openList: string;
}

function emptyBook(): Book {
    const list = { id: newId(), name: 'General' };
    return { lists: [list], notes: [], openList: list.id };
}

/** A book filled from rows of the mock, in their order from the top. */
function bookOf(rows: [string, string, number, number | null][]): Book {
    const now = Date.now();
    const lists: NoteList[] = [];
    const notes: Note[] = rows.map(([listName, text, age, doneAge], index) => {
        let list = lists.find((l) => l.name === listName);
        if (!list) {
            list = { id: newId(), name: listName };
            lists.push(list);
        }
        return {
            id: newId(),
            list: list.id,
            position: index,
            text,
            created: now - age,
            edited: now - age,
            done: doneAge === null ? null : now - doneAge,
        };
    });
    return { lists, notes, openList: lists[0].id };
}

/** In `large`, a list long enough to need its cards virtualized. */
function largeBook(): Book {
    const rows: [string, string, number, number | null][] = Array.from({ length: 600 }, (_, n) => [
        n % 5 === 0 ? 'Long' : 'General',
        n % 7 === 0 ? `${n}: ${LONG_ANSWER}` : `Note ${n}: try the change on the large fixture`,
        n * MINUTE,
        n % 9 === 0 ? n * MINUTE : null,
    ]);
    return bookOf(rows);
}

/**
 * Notes in memory, as the backend keeps them (`src-tauri/src/modules/notes/book.rs`): the
 * scenario's project starts with the mock's notes, any other with none.
 */
export function fixtureNotes(
    initial: (root: string) => 'review' | 'large' | 'empty',
    checkRoot: (root: string) => void,
): NotesPort & {
    peek: (root: string) => ProjectNotes;
    drop: (root: string) => void;
    relink: (from: string, to: string) => void;
} {
    const books = new Map<string, Book>();
    const book = (root: string): Book => {
        checkRoot(root);
        let found = books.get(root);
        if (!found) {
            const kind = initial(root);
            found =
                kind === 'review'
                    ? bookOf(REVIEW_NOTES)
                    : kind === 'large'
                      ? largeBook()
                      : emptyBook();
            books.set(root, found);
        }
        return found;
    };
    const snapshot = (b: Book): ProjectNotes => ({
        lists: b.lists.map((l) => ({ ...l })),
        notes: b.notes.map((n) => ({ ...n })),
        openList: b.openList,
    });
    const note = (b: Book, id: string) => {
        const found = b.notes.find((n) => n.id === id);
        if (!found) throw failure('note_missing');
        return found;
    };
    const list = (b: Book, id: string) => {
        const found = b.lists.find((l) => l.id === id);
        if (!found) throw failure('note_missing');
        return found;
    };
    return {
        /** The notes as they are, for the palette's search. */
        peek: (root) => snapshot(book(root)),
        /** A project removed takes its notes, as the backend's `remove_project`. */
        drop: (root) => {
            books.delete(root);
        },
        /**
         * A project found elsewhere takes its notes there, as the backend's `relink`; into the
         * notes there, if any (lists of one name join, without the backend's placing).
         */
        relink: (from, to) => {
            const moved = books.get(from);
            books.delete(from);
            if (!moved) return;
            const target = books.get(to);
            if (!target) {
                books.set(to, moved);
                return;
            }
            for (const list of moved.lists) {
                const same = target.lists.find((l) => l.name === list.name);
                if (!same) target.lists.push(list);
                for (const n of moved.notes.filter((n) => n.list === list.id)) {
                    target.notes.push({ ...n, list: same?.id ?? list.id });
                }
            }
        },
        getNotes: async (root) => snapshot(book(root)),
        addNote: async (root, listId, text) => {
            const b = book(root);
            list(b, listId);
            const now = Date.now();
            const added: Note = {
                id: newId(),
                list: listId,
                position: positionAt(openNotes(b.notes, listId), '', 0),
                text,
                created: now,
                edited: now,
                done: null,
            };
            b.notes.push(added);
            return { ...added };
        },
        // as the backend, without renumbering: positions here never run out of room
        setNoteText: async (root, id, text) => {
            const found = note(book(root), id);
            if (found.text !== text) {
                found.text = text;
                found.edited = Date.now();
            }
            return { ...found };
        },
        setNoteDone: async (root, id, done) => {
            const found = note(book(root), id);
            if ((found.done !== null) !== done) found.done = done ? Date.now() : null;
            return { ...found };
        },
        placeNote: async (root, id, listId, index) => {
            const b = book(root);
            list(b, listId);
            const moved = note(b, id);
            moved.position = positionAt(openNotes(b.notes, listId), id, index);
            moved.list = listId;
            return [{ ...moved }];
        },
        restoreNote: async (root, restored) => {
            const b = book(root);
            list(b, restored.list);
            b.notes = [...b.notes.filter((n) => n.id !== restored.id), { ...restored }];
            return { ...restored };
        },
        deleteNote: async (root, id) => {
            const b = book(root);
            note(b, id);
            b.notes = b.notes.filter((n) => n.id !== id);
        },
        addList: async (root, name) => {
            const b = book(root);
            const added = { id: newId(), name: name.trim() };
            b.lists.push(added);
            b.openList = added.id;
            return { ...added };
        },
        renameList: async (root, id, name) => {
            const found = list(book(root), id);
            found.name = name.trim();
            return { ...found };
        },
        deleteList: async (root, id) => {
            const b = book(root);
            const index = b.lists.indexOf(list(b, id));
            if (b.lists.length === 1) throw failure('unknown');
            const [gone] = b.lists.splice(index, 1);
            const notes = b.notes.filter((n) => n.list === id);
            b.notes = b.notes.filter((n) => n.list !== id);
            if (b.openList === id) b.openList = b.lists[0].id;
            const deleted: DeletedList = { list: gone, index, notes };
            return deleted;
        },
        restoreList: async (root, deleted) => {
            const b = book(root);
            b.lists.splice(Math.min(deleted.index, b.lists.length), 0, { ...deleted.list });
            b.notes.push(...deleted.notes.map((n) => ({ ...n })));
            b.openList = deleted.list.id;
            return snapshot(b);
        },
        // as the backend's `Book::summary`
        notesSummary: async (root) => {
            const open = book(root).notes.filter((n) => n.done === null);
            const newest = open.reduce<Note | null>(
                (best, n) =>
                    !best ||
                    n.created > best.created ||
                    (n.created === best.created && n.position < best.position)
                        ? n
                        : best,
                null,
            );
            return { open: open.length, newest: newest ? noteTitle(newest.text) : null };
        },
        countNotes: async (root) => book(root).notes.length,
        // as if saved where the dialog first offers
        exportNotes: async (root) => {
            book(root);
            return `${root.split('/').slice(0, 3).join('/')}/Documents/${root.split('/').pop()}-notes.md`;
        },
        openList: async (root, id) => {
            const b = book(root);
            list(b, id);
            b.openList = id;
        },
    };
}
