import { type ReactNode, useEffect, useState } from 'react';
import { QuickNote } from '@/modules/notes';
import type { QuickNotePhase } from '@/shared/platform/quick-note';
import { useQuickNotePort } from './providers';

/** Runs `then` once the frame now committed is painted; returns a cancel. */
function afterPaint(then: () => void): () => void {
    let second = 0;
    const first = requestAnimationFrame(() => {
        second = requestAnimationFrame(then);
    });
    return () => {
        cancelAnimationFrame(first);
        cancelAnimationFrame(second);
    };
}

/**
 * The quick note over the layout, as the backend asks (`QuickNotePort`). The layout stays
 * mounted, hidden while the note shows, so where it was and what it read stay; the note stays
 * mounted once opened, so what was typed waits for the next time. Each phase is told painted,
 * after which the window shows it: a hidden page paints only once shown again, so a layout put
 * back while the window is hidden is told at its next show. A click outside the note closes it,
 * as `Esc`, once it shows (hiding the window to change it is no click).
 */
export function QuickNoteHost({ children }: { children: ReactNode }) {
    const port = useQuickNotePort();
    // a new object at each phase asked, even the same again
    const [asked, setAsked] = useState<{ phase: QuickNotePhase } | null>(null);
    const [shown, setShown] = useState(false);
    const open = asked?.phase === 'open';

    useEffect(() => port.onPhase((phase) => setAsked({ phase })), [port]);
    useEffect(() => {
        if (!asked) return;
        setShown(false);
        return afterPaint(() => {
            if (asked.phase === 'open') {
                port.shown();
                setShown(true);
            } else {
                port.restored();
            }
        });
    }, [asked, port]);
    useEffect(() => {
        if (!open || !shown) return;
        const close = () => port.close();
        window.addEventListener('blur', close);
        return () => window.removeEventListener('blur', close);
    }, [open, shown, port]);

    return (
        <>
            {asked ? <QuickNote open={open} onDone={() => port.close()} /> : null}
            <div className={open ? 'hidden' : 'contents'}>{children}</div>
        </>
    );
}
