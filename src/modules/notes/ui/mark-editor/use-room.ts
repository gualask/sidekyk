import { type RefObject, useEffect, useState } from 'react';

export interface Size {
    width: number;
    height: number;
}

/** The room `stage` gives the image, as it resizes; null until measured. */
export function useRoom(stage: RefObject<HTMLDivElement | null>): Size | null {
    const [room, setRoom] = useState<Size | null>(null);
    useEffect(() => {
        const element = stage.current;
        if (!element) return;
        const observer = new ResizeObserver(([entry]) =>
            setRoom({ width: entry.contentRect.width, height: entry.contentRect.height }),
        );
        observer.observe(element);
        return () => observer.disconnect();
    }, [stage]);
    return room;
}
