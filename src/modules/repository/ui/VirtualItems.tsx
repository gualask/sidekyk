import type { Virtualizer } from '@tanstack/react-virtual';
import type { ReactNode } from 'react';

/** The rows of a `useVirtualRows` list that are on screen, each at its place. */
export function VirtualItems<E extends HTMLElement>({
    virtualizer,
    children,
}: {
    virtualizer: Virtualizer<E, Element>;
    children: (index: number) => ReactNode;
}) {
    return (
        <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((item) => (
                <div
                    key={item.key}
                    className="absolute top-0 left-0 w-full"
                    style={{ transform: `translateY(${item.start}px)` }}
                >
                    {children(item.index)}
                </div>
            ))}
        </div>
    );
}
