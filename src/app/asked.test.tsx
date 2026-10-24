// @vitest-environment happy-dom
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@/shared/testing/render-hook';
import { type Asked, useWaitingAsked } from './asked';

const NOTE: Asked = { project: 'shop', panel: 'notes', target: { key: 'note' } };

describe('useWaitingAsked', () => {
    it("waits for the project's panels, then gives what was asked once", () => {
        const give = vi.fn();
        const { result, rerender } = renderHook(
            (shown: string | null) => useWaitingAsked(shown, give),
            // at all projects: no panels show
            { props: null },
        );
        act(() => result.current(NOTE));
        // another project's panels, then the project activated while its folder's kind is read
        rerender('docs');
        rerender(null);
        expect(give).not.toHaveBeenCalled();

        rerender('shop');
        expect(give).toHaveBeenCalledExactlyOnceWith(NOTE);
        // given once: shown again, nothing more
        rerender('docs');
        rerender('shop');
        expect(give).toHaveBeenCalledTimes(1);
    });

    it('gives at once when the project already shows', () => {
        const give = vi.fn();
        const { result } = renderHook((shown: string | null) => useWaitingAsked(shown, give), {
            props: 'shop',
        });
        act(() => result.current(NOTE));
        expect(give).toHaveBeenCalledExactlyOnceWith(NOTE);
    });

    it('lets go of what was asked when told so (back at all projects)', () => {
        const give = vi.fn();
        const { result, rerender } = renderHook(
            (shown: string | null) => useWaitingAsked(shown, give),
            { props: null },
        );
        act(() => result.current(NOTE));
        act(() => result.current(null));
        rerender('shop');
        expect(give).not.toHaveBeenCalled();
    });
});
