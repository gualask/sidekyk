import type { RuntimePorts } from '@/infrastructure/runtime-ports';
import type { CompactPhase, CompactView } from '@/shared/platform/compact-window';

/** The window's ports in a browser tab, and what stands in for the quick note's shortcut. */
export function fixtureWindow(): {
    ports: Pick<RuntimePorts, 'titleBar' | 'compactWindow' | 'reportError' | 'showWindow'>;
    /** As the quick note's global shortcut: opens it, or closes it when open, as `Esc`. */
    toggleQuickNote: () => void;
    /** As an area taken: the capture window opens, fitted to the image, unless a view is open. */
    openCapture: (width: number, height: number) => void;
} {
    // a browser tab has no window to shrink, so the phases follow at once
    const listeners = new Set<(phase: CompactPhase) => void>();
    let open: CompactView | null = null;
    const phase = (next: CompactPhase) => {
        open = next.kind === 'open' ? next.view : null;
        for (const listener of listeners) listener(next);
    };
    return {
        ports: {
            // a browser tab draws no window controls over the page
            titleBar: { overlaid: false, onOverlaidChange: () => () => undefined },
            compactWindow: {
                onPhase: (listener) => {
                    listeners.add(listener);
                    return () => listeners.delete(listener);
                },
                shown: () => undefined,
                close: () => {
                    if (open) phase({ kind: 'close' });
                },
                restored: () => undefined,
            },
            // the browser console already shows them
            reportError: () => undefined,
            showWindow: () => undefined,
        },
        toggleQuickNote: () => {
            if (open === 'capture') return;
            phase(
                open
                    ? { kind: 'close' }
                    : { kind: 'open', view: 'quickNote', width: 560, height: 168 },
            );
        },
        // the backend's frame for a 1470 x 923 pt display (`compact_frame.rs`)
        openCapture: (width, height) => {
            if (open) return;
            const side = (image: number, around: number, room: number, least: number) =>
                Math.min(Math.max(image + around, least), Math.round(room * 0.7));
            phase({
                kind: 'open',
                view: 'capture',
                width: side(width / 2, 32, 1470, 560),
                height: side(height / 2, 232, 923, 400),
            });
        },
    };
}
