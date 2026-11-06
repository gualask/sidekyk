// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@/shared/testing/render-hook';
import { useRanking } from './use-ranking';

function rankingWrapper() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
}

describe('names ranked for a query', () => {
    it('are ranked though the names are built again at each render', async () => {
        const rank = vi.fn(async () => [1]);
        const { result } = renderHook(
            // a new list each time, as a caller that does not keep it
            ({ query }: { query: string }) => useRanking(rank, query, ['casa', 'shop']),
            { props: { query: 'sh' }, wrapper: rankingWrapper() },
        );
        await vi.waitFor(() => expect(result.current).toEqual({ order: [1], pending: false }));
    });

    it('keep the previous ranking while the next comes, saying it is not the answer yet', async () => {
        const names = ['casa', 'shop', 'shop-web'];
        let answer: (order: number[]) => void = () => {};
        const rank = vi.fn((query: string) =>
            query === 'sh'
                ? Promise.resolve([1, 2])
                : new Promise<number[]>((resolve) => {
                      answer = resolve;
                  }),
        );
        const { result, rerender } = renderHook(
            ({ query }: { query: string }) => useRanking(rank, query, names),
            { props: { query: 'sh' }, wrapper: rankingWrapper() },
        );
        await vi.waitFor(() => expect(result.current.pending).toBe(false));

        rerender({ query: 'shw' });
        expect(result.current).toEqual({ order: [1, 2], pending: true });

        answer([2]);
        await vi.waitFor(() => expect(result.current).toEqual({ order: [2], pending: false }));
    });

    it('are the names in their order, not pending, with nothing typed', () => {
        const rank = vi.fn(async () => []);
        const { result } = renderHook(() => useRanking(rank, '  ', ['casa']), {
            wrapper: rankingWrapper(),
        });
        expect(result.current).toEqual({ order: null, pending: false });
        expect(rank).not.toHaveBeenCalled();
    });
});
