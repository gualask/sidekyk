import { type ReactNode, useEffect, useState } from 'react';
import { CaptureWindow, QuickNote } from '@/modules/notes';
import type { CompactPhase } from '@/shared/platform/compact-window';
import { useCompactWindowPort } from './providers';

/** A phase that changes what shows: a view, or the layout back. */
type OpenOrClose = Exclude<CompactPhase, { kind: 'closeAsked' }>;

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
 * The compact window's view over the layout, as the backend asks (`CompactWindowPort`). The
 * layout stays mounted, hidden while a view shows, so where it was and what it read stay; the
 * quick note stays mounted once opened, so what was typed waits for the next time; the capture
 * window mounts while it shows, its draft held apart. Each phase is told painted, after which the
 * window shows it: a hidden page paints only once shown again, so a layout put back while the
 * window is hidden is told at its next show. A click outside the quick note closes it, as `Esc`,
 * once it shows (hiding the window to change it is no click); the capture window stays, its +
 * taking the focus to the capture's overlay. The window asked to close (`⌘W`) is the capture
 * window's `Esc`.
 */
export function CompactHost({ children }: { children: ReactNode }) {
    const port = useCompactWindowPort();
    // a new object at each phase asked, even the same again
    const [asked, setAsked] = useState<{ phase: OpenOrClose } | null>(null);
    const [shown, setShown] = useState(false);
    // the quick note, once opened, stays mounted with its draft
    const [noteMounted, setNoteMounted] = useState(false);
    const [closeAsked, setCloseAsked] = useState(0);
    const open = asked?.phase.kind === 'open' ? asked.phase : null;
    const view = open?.view ?? null;

    useEffect(
        () =>
            port.onPhase((phase) => {
                if (phase.kind === 'closeAsked') {
                    setCloseAsked((count) => count + 1);
                    return;
                }
                if (phase.kind === 'open' && phase.view === 'quickNote') setNoteMounted(true);
                setAsked({ phase });
            }),
        [port],
    );
    useEffect(() => {
        if (!asked) return;
        setShown(false);
        return afterPaint(() => {
            if (asked.phase.kind === 'open') {
                port.shown();
                setShown(true);
            } else {
                port.restored();
            }
        });
    }, [asked, port]);
    useEffect(() => {
        if (view !== 'quickNote' || !shown) return;
        const close = () => port.close();
        window.addEventListener('blur', close);
        return () => window.removeEventListener('blur', close);
    }, [view, shown, port]);

    return (
        <>
            {noteMounted ? (
                <QuickNote open={view === 'quickNote'} onDone={() => port.close()} />
            ) : null}
            {open?.view === 'capture' ? (
                <CaptureWindow size={open} closeAsked={closeAsked} onDone={() => port.close()} />
            ) : null}
            <div className={view ? 'hidden' : 'contents'}>{children}</div>
        </>
    );
}
