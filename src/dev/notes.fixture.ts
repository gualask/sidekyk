import {
    type BookTarget,
    type DeletedList,
    INBOX_BOOK,
    type ListTarget,
    type MovedList,
    type Note,
    type NoteList,
    type NotesPort,
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
    ['General', 'Try `[`/`]` against the overview for switching', 4 * DAY, 2 * DAY],
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
 * Notes in memory, as the backend keeps them (`src-tauri/crates/core/src/modules/notes/store.rs`):
 * the scenario's project starts with the mock's notes, any other book with none. `checkBook`
 * refuses a book the backend would not know. A move to a new project makes it with `makeProject`
 * (its id back), takes it away with `dropProject` when the move fails, and says the projects
 * changed (`projectsChanged`) when it is done.
 */
export function fixtureNotes({
    initial,
    checkBook,
    makeProject,
    dropProject,
    projectsChanged,
}: {
    initial: (book: string) => 'review' | 'large' | 'empty';
    checkBook: (book: string) => void;
    makeProject: (name: string) => string;
    dropProject: (id: string) => void;
    projectsChanged: () => void;
}): NotesPort & {
    peek: (book: string) => ProjectNotes;
    drop: (book: string) => void;
} {
    const books = new Map<string, Book>();
    const book = (key: string): Book => {
        checkBook(key);
        let found = books.get(key);
        if (!found) {
            const kind = initial(key);
            found =
                kind === 'review'
                    ? bookOf(REVIEW_NOTES)
                    : kind === 'large'
                      ? largeBook()
                      : emptyBook();
            books.set(key, found);
        }
        return found;
    };
    // as the store's `project_only`: the Inbox has one list, never changed, and no done
    const projectBook = (key: string) => {
        if (key === INBOX_BOOK) throw failure('unknown');
        return book(key);
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
        if (!found) throw failure('note_list_missing');
        return found;
    };
    /** Puts a note in, in place of the one with its id if any. */
    const replace = (b: Book, put: Note) => {
        b.notes = [...b.notes.filter((n) => n.id !== put.id), { ...put }];
    };
    const takeOut = (b: Book, id: string) => {
        b.notes = b.notes.filter((n) => n.id !== id);
    };
    /** Takes a list out; when it was open, the first left opens. */
    const removeList = (b: Book, id: string) => {
        b.lists = b.lists.filter((l) => l.id !== id);
        if (b.openList === id) b.openList = b.lists[0].id;
    };
    /** The list a moved note goes to, made when asked for. */
    const targetList = (b: Book, target: ListTarget) => {
        if (target.kind === 'open') return b.openList;
        if (target.kind === 'list') return list(b, target.id).id;
        const added = { id: newId(), name: target.name.trim() };
        b.lists.push(added);
        return added.id;
    };
    /** Runs a move into the book `to` names; a project made for it goes when the move fails. */
    const into = <T>(to: BookTarget, run: (key: string) => T): T => {
        if (to.kind === 'book') return run(to.book);
        const made = makeProject(to.name);
        try {
            const moved = run(made);
            projectsChanged();
            return moved;
        } catch (error) {
            dropProject(made);
            throw error;
        }
    };
    /** Takes a book's list out with its notes; the last list stays. */
    const takeList = (b: Book, id: string): DeletedList => {
        const gone = list(b, id);
        const index = b.lists.indexOf(gone);
        if (b.lists.length === 1) throw failure('unknown');
        removeList(b, id);
        const notes = b.notes.filter((n) => n.list === id);
        b.notes = b.notes.filter((n) => n.list !== id);
        return { list: gone, index, notes };
    };
    const putList = (b: Book, deleted: DeletedList) => {
        b.lists.splice(Math.min(deleted.index, b.lists.length), 0, { ...deleted.list });
        for (const back of deleted.notes) replace(b, back);
        b.openList = deleted.list.id;
    };
    return {
        /** The notes as they are, for the palette's search. */
        peek: (key) => snapshot(book(key)),
        /** A project removed takes its notes, as the backend's `remove_project`. */
        drop: (key) => {
            books.delete(key);
        },
        getNotes: async (key) => snapshot(book(key)),
        addNote: async (key, listId, text) => {
            const b = book(key);
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
        setNoteText: async (key, id, text) => {
            const found = note(book(key), id);
            if (found.text !== text) {
                found.text = text;
                found.edited = Date.now();
            }
            return { ...found };
        },
        setNoteDone: async (key, id, done) => {
            const found = note(projectBook(key), id);
            if ((found.done !== null) !== done) found.done = done ? Date.now() : null;
            return { ...found };
        },
        placeNote: async (key, id, listId, index) => {
            const b = projectBook(key);
            list(b, listId);
            const moved = note(b, id);
            moved.position = positionAt(openNotes(b.notes, listId), id, index);
            moved.list = listId;
            return [{ ...moved }];
        },
        restoreNote: async (key, restored) => {
            const b = book(key);
            list(b, restored.list);
            replace(b, restored);
            return { ...restored };
        },
        deleteNote: async (key, id) => {
            const b = book(key);
            note(b, id);
            takeOut(b, id);
        },
        moveNote: async (from, id, to, target) =>
            into(to, (key) => {
                const inbox = key === INBOX_BOOK;
                if (inbox && target.kind !== 'open') throw failure('unknown');
                const source = book(from);
                const dest = book(key);
                const moved = note(source, id);
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
            }),
        unmoveNote: async (at, original, home) => {
            const back = book(home);
            list(back, original.list);
            takeOut(book(at), original.id);
            replace(back, original);
            return { ...original };
        },
        moveList: async (from, listId, to) =>
            into(to, (key) => {
                const source = projectBook(from);
                const dest = projectBook(key);
                const left = takeList(source, listId);
                const name = left.list.name.toLowerCase();
                const same = dest.lists.find((l) => l.name.toLowerCase() === name);
                const taker = same ?? { id: newId(), name: left.list.name };
                if (!same) dest.lists.push(taker);
                let bottom = openNotes(dest.notes, taker.id).at(-1)?.position ?? -1;
                const notes = [...left.notes].sort((a, b) => a.position - b.position);
                for (const moved of notes) {
                    if (moved.done === null) bottom += 1;
                    const position = moved.done === null ? bottom : moved.position;
                    replace(dest, { ...moved, list: taker.id, position });
                }
                const result: MovedList = {
                    from,
                    to: key,
                    left,
                    into: taker.id,
                    joined: same !== undefined,
                };
                return result;
            }),
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
            const found = list(projectBook(key), id);
            found.name = name.trim();
            return { ...found };
        },
        deleteList: async (key, id) => takeList(projectBook(key), id),
        restoreList: async (key, deleted) => {
            const b = projectBook(key);
            putList(b, deleted);
            return snapshot(b);
        },
        // as the backend's `NoteBook::summary`
        notesSummary: async (key) => {
            const { notes } = book(key);
            const open = notes.filter((n) => n.done === null).length;
            const edited = notes.map((n) => n.edited);
            return {
                open,
                done: notes.length - open,
                lastEdited: edited.length ? Math.max(...edited) : null,
            };
        },
        countNotes: async (key) => book(key).notes.length,
        // as if saved where the dialog first offers
        exportNotes: async (projectId) => {
            projectBook(projectId);
            return '/Users/dev/Documents/notes.md';
        },
        openList: async (key, id) => {
            const b = projectBook(key);
            list(b, id);
            b.openList = id;
        },
    };
}
