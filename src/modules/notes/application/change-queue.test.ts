import { describe, expect, it } from 'vitest';
import { ChangeQueue } from './change-queue';

/** A call whose answer comes when `answer` is called. */
function deferred<T>() {
    let answer: (value: T) => void = () => undefined;
    const promise = new Promise<T>((resolve) => {
        answer = resolve;
    });
    return { promise, answer };
}

describe('ChangeQueue', () => {
    it('runs changes one at a time, in order', async () => {
        const queue = new ChangeQueue();
        const started: string[] = [];
        const first = deferred<string>();
        const a = queue.run(() => {
            started.push('a');
            return first.promise;
        });
        const b = queue.run(async () => {
            started.push('b');
            return 'b';
        });
        await Promise.resolve();
        expect(started).toEqual(['a']);
        first.answer('a');
        expect(await a).toEqual({ kind: 'skip', value: 'a' });
        expect(await b).toEqual({ kind: 'reread', value: 'b' });
        expect(started).toEqual(['a', 'b']);
    });

    it('applies the answer of a change nothing waits behind', async () => {
        const queue = new ChangeQueue();
        expect(await queue.run(async () => 1)).toEqual({ kind: 'apply', value: 1 });
    });

    // a failure reads the notes again by itself (`useNoteActions`): nothing is skipped
    it('goes on after a change that failed', async () => {
        const queue = new ChangeQueue();
        const failed = queue.run(async () => {
            throw new Error('disk full');
        });
        const next = queue.run(async () => 2);
        await expect(failed).rejects.toThrow('disk full');
        expect(await next).toEqual({ kind: 'apply', value: 2 });
    });
});
