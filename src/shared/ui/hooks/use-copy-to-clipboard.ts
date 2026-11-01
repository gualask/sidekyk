import { useCallback, useEffect, useRef, useState } from 'react';
import type { Translator } from '@/shared/i18n';

export type CopyState = { id: string; ok: boolean } | null;

/** What a copy control says: `idle` until used, then whether it worked. */
export function copyLabel(copied: CopyState, idle: string, i18n: Translator): string {
    if (!copied) return idle;
    return i18n.t(copied.ok ? 'copy.done' : 'copy.failed');
}

/**
 * Copies text, or what a promise gives (asked of the backend on the click), and remembers, for a
 * moment, which item was copied and whether it worked, so the item can show its own confirmation.
 */
export function useCopyToClipboard(resetMs = 1400) {
    const [state, setState] = useState<CopyState>(null);
    const timer = useRef<number | undefined>(undefined);

    useEffect(() => () => window.clearTimeout(timer.current), []);

    /** Runs a write to the clipboard and says how it went. */
    const run = useCallback(
        async (id: string, write: () => Promise<void>) => {
            let ok = true;
            try {
                await write();
            } catch {
                ok = false;
            }
            window.clearTimeout(timer.current);
            setState({ id, ok });
            timer.current = window.setTimeout(() => setState(null), resetMs);
        },
        [resetMs],
    );
    const copy = useCallback(
        (id: string, text: string | Promise<string>) =>
            run(id, async () => navigator.clipboard.writeText(await text)),
        [run],
    );
    /** Copies a PNG image; the promise lets the click's handler write while it is made. */
    const copyImage = useCallback(
        (id: string, png: Promise<Blob>) =>
            run(id, () => navigator.clipboard.write([new ClipboardItem({ 'image/png': png })])),
        [run],
    );

    return { copied: state, copy, copyImage };
}
