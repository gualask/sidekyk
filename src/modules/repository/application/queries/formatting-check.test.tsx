// @vitest-environment happy-dom
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@/shared/testing/render-hook';
import type { RepositorySnapshot } from '../../model/repository.types';
import { changedFile } from '../../model/testing';
import { repositoryWrapper } from '../testing';
import { type SnapshotRead, useFormattingCheck } from './formatting-check';

const INDENTED = changedFile('src/cart.ts', { additions: 4, deletions: 4 });

const SNAPSHOT: RepositorySnapshot = {
    files: [INDENTED],
    summary: {
        branch: { head: 'main', commit: 'a1b2c3d', upstream: null, ahead: 0, behind: 0 },
        totals: { files: 1, additions: 4, deletions: 4 },
        truncated: false,
    },
};

function formattingPort() {
    // all of it formatting: git -w leaves the file out
    const getChangesIgnoringWhitespace = vi.fn(async () => ({ files: [], truncated: false }));
    // the one method this hook calls
    const wrapper = repositoryWrapper({ getChangesIgnoringWhitespace });
    return { getChangesIgnoringWhitespace, wrapper };
}

describe('the check of formatting over every change', () => {
    it('runs on request only, and its answer goes with the next snapshot read', async () => {
        const { getChangesIgnoringWhitespace, wrapper } = formattingPort();
        let snapshot: SnapshotRead = { data: SNAPSHOT, dataUpdatedAt: 1 };
        const { result, rerender } = renderHook(() => useFormattingCheck('p', snapshot), {
            wrapper,
        });
        expect(result.current.totals).toBeUndefined();
        expect(getChangesIgnoringWhitespace).not.toHaveBeenCalled();

        act(() => result.current.check());
        await vi.waitFor(() =>
            expect(result.current.totals).toEqual({
                lines: 8,
                changed: 8,
                files: 1,
                changedFiles: 1,
            }),
        );

        // a change on disk with the same counts keeps the files, not the answer
        snapshot = { data: SNAPSHOT, dataUpdatedAt: 2 };
        rerender(undefined);
        expect(result.current.totals).toBeUndefined();
        expect(getChangesIgnoringWhitespace).toHaveBeenCalledTimes(1);
    });
});
