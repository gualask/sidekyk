// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@/shared/testing/render-hook';
import type { NoteActions } from '../../../application/note-actions/note-actions';
import type { Note } from '../../../model/notes.types';
import { useTextSaving } from './use-text-saving';

const NOTE = { id: 'n1', text: 'first', images: [] } as unknown as Note;

/** Actions whose saves answer as `answers` says, in turn. */
function actionsAnswering(...answers: boolean[]) {
    const setText = vi.fn(async () => answers.shift() ?? true);
    const actions = { setText, remove: vi.fn() } as unknown as NoteActions;
    return { actions, setText };
}

describe('useTextSaving', () => {
    afterEach(() => vi.useRealTimers());

    it('saves again on close a text whose save failed', async () => {
        vi.useFakeTimers();
        const { actions, setText } = actionsAnswering(false, true);
        const { result } = renderHook(() => useTextSaving(actions, NOTE));
        result.current.typed('second');
        // the pause's save, and its answer
        await vi.advanceTimersByTimeAsync(1000);
        expect(setText).toHaveBeenCalledTimes(1);

        result.current.close();
        expect(setText).toHaveBeenCalledTimes(2);
        expect(setText).toHaveBeenLastCalledWith('n1', 'second');
    });

    it('does not save again on close a text already saved', async () => {
        vi.useFakeTimers();
        const { actions, setText } = actionsAnswering(true);
        const { result } = renderHook(() => useTextSaving(actions, NOTE));
        result.current.typed('second');
        // the pause's save, and its answer
        await vi.advanceTimersByTimeAsync(1000);

        result.current.close();
        expect(setText).toHaveBeenCalledTimes(1);
    });
});
