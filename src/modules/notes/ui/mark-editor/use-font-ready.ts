import { useEffect, useState } from 'react';
import { markFont } from './drawing/draw-marks';

/** Whether the marks' font at `size` is loaded. */
export function useFontReady(size: number, family: string): boolean {
    const [ready, setReady] = useState(false);
    useEffect(() => {
        let live = true;
        void document.fonts.load(markFont(size, family)).then(() => {
            if (live) setReady(true);
        });
        return () => {
            live = false;
        };
    }, [size, family]);
    return ready;
}
