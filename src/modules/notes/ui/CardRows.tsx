import type { ReactNode } from 'react';
import type { CardRowsState } from './use-card-rows';

/** The column of `useCardRows`, filling what is left below what comes before it. */
export function CardRows({
    rows: { scroller, virtualizer },
    children,
}: {
    rows: CardRowsState;
    /** The row at an index. */
    children: (index: number) => ReactNode;
}) {
    return (
        <div ref={scroller} className="min-h-0 flex-1 overflow-auto px-3">
            <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
                {virtualizer.getVirtualItems().map((row) => (
                    <div
                        key={row.key}
                        ref={virtualizer.measureElement}
                        data-index={row.index}
                        className="absolute top-0 left-0 w-full"
                        style={{ transform: `translateY(${row.start}px)` }}
                    >
                        {children(row.index)}
                    </div>
                ))}
            </div>
        </div>
    );
}
