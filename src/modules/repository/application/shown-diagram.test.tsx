// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@/shared/testing/render-hook';
import type { Diagram, DiagramColors, DiagramRequest } from '../model/repository.types';
import { type RepositoryPort, RepositoryProvider } from './repository.port';
import { useShownDiagram } from './repository.queries';

const COLORS = { dark: true, series: ['#6366f1'] } as DiagramColors;

const DRAWN: Diagram = { kind: 'drawn', svg: '<svg/>', width: 120, height: 80 };
const INVALID: Diagram = { kind: 'invalid', detail: 'unexpected end of input' };

/** A port that draws `flowchart TD …` and finds anything else invalid. */
function diagramPort() {
    const renderDiagram = vi.fn(async ({ source }: DiagramRequest) =>
        source.endsWith('B') ? DRAWN : INVALID,
    );
    const port = { renderDiagram } as unknown as RepositoryPort;
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>
            <RepositoryProvider value={port}>{children}</RepositoryProvider>
        </QueryClientProvider>
    );
    return { renderDiagram, wrapper };
}

describe('the diagram a source shows', () => {
    it('is drawn, then kept while the source does not read, with why', async () => {
        const { renderDiagram, wrapper } = diagramPort();
        const { result, rerender } = renderHook(
            ({ source }: { source: string }) => useShownDiagram(source, COLORS),
            { props: { source: 'flowchart TD\n  A --> B' }, wrapper },
        );
        await vi.waitFor(() => expect(result.current.drawn).toEqual(DRAWN));
        expect(result.current.invalid).toBeNull();
        expect(renderDiagram).toHaveBeenCalledWith({
            source: 'flowchart TD\n  A --> B',
            colors: COLORS,
        });

        // an agent halfway through: the diagram stays, the reason comes with it
        rerender({ source: 'flowchart TD\n  A -->' });
        expect(result.current.drawn).toEqual(DRAWN);
        await vi.waitFor(() => expect(result.current.invalid).toEqual(INVALID));
        expect(result.current.drawn).toEqual(DRAWN);
    });

    it('shows nothing drawn for a source that never read', async () => {
        const { wrapper } = diagramPort();
        const { result } = renderHook(() => useShownDiagram('flowchart TD\n  A -->', COLORS), {
            wrapper,
        });
        await vi.waitFor(() => expect(result.current.invalid).toEqual(INVALID));
        expect(result.current.drawn).toBeNull();
        expect(result.current.error).toBeNull();
    });
});
