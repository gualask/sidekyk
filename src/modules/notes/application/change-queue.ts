/** What to do with a change's answer once it is back. */
export type Answer<T> =
    /** The last change: its answer is the notes as stored. */
    | { kind: 'apply'; value: T }
    /** The last change, after answers skipped: the notes are read again, whole. */
    | { kind: 'reread'; value: T }
    /** Changes wait behind it: what is on screen is newer than its answer. */
    | { kind: 'skip'; value: T };

/**
 * A book's changes to its notes, one at a time in the order they were made: the backend gets
 * them in that order, and an answer that came back while later changes waited is not shown over
 * them. Once the last one is back, the notes are read again if an answer was skipped.
 */
export class ChangeQueue {
    private tail: Promise<unknown> = Promise.resolve();
    private waiting = 0;
    private skipped = false;

    /** Runs `call` after the changes made before it. A failure rejects, as `call` did. */
    async run<T>(call: () => Promise<T>): Promise<Answer<T>> {
        this.waiting += 1;
        const result = this.tail.then(call);
        this.tail = result.catch(() => undefined);
        try {
            const value = await result;
            if (this.waiting > 1) {
                this.skipped = true;
                return { kind: 'skip', value };
            }
            const reread = this.skipped;
            this.skipped = false;
            return { kind: reread ? 'reread' : 'apply', value };
        } finally {
            this.waiting -= 1;
        }
    }
}

const queues = new Map<string, ChangeQueue>();

/** The queue of a book's changes. */
export function changeQueue(book: string): ChangeQueue {
    let queue = queues.get(book);
    if (!queue) {
        queue = new ChangeQueue();
        queues.set(book, queue);
    }
    return queue;
}
