import type { RuntimePorts } from '@/infrastructure/tauri/runtime';
import type { QuickNotePhase } from '@/shared/platform/quick-note';

/** The window's ports in a browser tab, and what stands in for the quick note's shortcut. */
export function fixtureWindow(): {
    ports: Pick<RuntimePorts, 'titleBar' | 'quickNote' | 'reportError' | 'showWindow'>;
    /** As the quick note's global shortcut: opens it, or closes it when open, as `Esc`. */
    toggleQuickNote: () => void;
} {
    // the quick note: a browser tab has no window to shrink, so the phases follow at once
    const listeners = new Set<(phase: QuickNotePhase) => void>();
    let open = false;
    const phase = (next: QuickNotePhase) => {
        open = next === 'open';
        for (const listener of listeners) listener(next);
    };
    return {
        ports: {
            // a browser tab draws no window controls over the page
            titleBar: { overlaid: false, onOverlaidChange: () => () => undefined },
            quickNote: {
                onPhase: (listener) => {
                    listeners.add(listener);
                    return () => listeners.delete(listener);
                },
                shown: () => undefined,
                close: () => {
                    if (open) phase('close');
                },
                restored: () => undefined,
            },
            // the browser console already shows them
            reportError: () => undefined,
            showWindow: () => undefined,
        },
        toggleQuickNote: () => phase(open ? 'close' : 'open'),
    };
}
