import { INBOX_BOOK, type Note, type NoteList } from '@/modules/notes';
import { REPOSITORY_IMAGES } from './fixture-files';
import { type Book, emptyBook } from './note-books.fixture';
import type { FixtureNoteImages } from './note-images.fixture';
import { TOPIC_PROJECT } from './projects.fixture-data';
import { hasScenarioData, isLarge, newId, type Scenario } from './scenario';

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

/** The Inbox's notes in `review` and `clean`, newest first: [text, age]. */
const INBOX_NOTES: [string, number][] = [
    ['Ask whether the WSL helper needs its own log file', 15 * MINUTE],
    ['Dentist on Thursday, 9:30: move the standup', 3 * HOUR],
    [
        '"Keep the watcher per repository and coalesce per directory" (from the agent, to try on the large fixture)',
        28 * HOUR,
    ],
    ['Book idea: a field guide to small tools that stay out of the way', 3 * DAY],
];

/** The notes of a project without folder, on a topic: [list, text, age, done age]. */
const TOPIC_NOTES: [string, string, number, number | null][] = [
    ['Chapter 2', 'Reread the section on related work: too long', 26 * HOUR, null],
    ['Chapter 2', 'Ask Prof. Rossi about the second dataset', 2 * DAY, null],
    ['Chapter 2', 'Fix the figure numbering', 5 * DAY, 3 * DAY],
    ['Reading', 'Lamport, "Time, Clocks, and the Ordering of Events"', 4 * DAY, null],
    ['Reading', 'Kleppmann, chapter 9', 9 * DAY, 6 * DAY],
    ['Reading', 'Brewer, "CAP twelve years later"', 12 * DAY, 8 * DAY],
];

/** Images of the review's notes, by the text of the note that holds them. */
const NOTE_IMAGES: Record<string, { url: string; size: number; width: number; height: number }[]> =
    {
        'Esc inside a note should leave the note, not zoom out': [
            { ...REPOSITORY_IMAGES['public/hero.png'], width: 640, height: 360 },
        ],
        'Ask whether the WSL helper needs its own log file': [
            { ...REPOSITORY_IMAGES['public/logo.png'], width: 128, height: 128 },
            { ...REPOSITORY_IMAGES['public/hero.png'], width: 640, height: 360 },
        ],
    };

/** A book filled from rows of the mock, in their order from the top. */
function bookOf(rows: [string, string, number, number | null][], images: FixtureNoteImages): Book {
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
            images: (NOTE_IMAGES[text] ?? []).map(images.served),
        };
    });
    return { lists, notes, openList: lists[0].id };
}

/** The Inbox's one list, holding the notes of `INBOX_NOTES`. */
function inboxBook(images: FixtureNoteImages): Book {
    return bookOf(
        INBOX_NOTES.map(([text, age]) => ['General', text, age, null]),
        images,
    );
}

/** In `large`, a list long enough to need its cards virtualized. */
function largeBook(images: FixtureNoteImages): Book {
    const rows: [string, string, number, number | null][] = Array.from({ length: 600 }, (_, n) => [
        n % 5 === 0 ? 'Long' : 'General',
        n % 7 === 0 ? `${n}: ${LONG_ANSWER}` : `Note ${n}: try the change on the large fixture`,
        n * MINUTE,
        n % 9 === 0 ? n * MINUTE : null,
    ]);
    return bookOf(rows, images);
}

/**
 * The notes a book starts with in `scenario`: the scenario's project with the mock's notes, the
 * Inbox with a few in `review` and `clean`, the project without folder with its topic's, any other
 * book with none. Their images are kept in `images`.
 */
export function initialNotes(scenario: Scenario, book: string, images: FixtureNoteImages): Book {
    if (book === INBOX_BOOK) {
        return scenario === 'review' || scenario === 'clean' ? inboxBook(images) : emptyBook();
    }
    if (book === TOPIC_PROJECT.id) return bookOf(TOPIC_NOTES, images);
    if (!hasScenarioData(scenario, book)) return emptyBook();
    return isLarge(scenario, book) ? largeBook(images) : bookOf(REVIEW_NOTES, images);
}
