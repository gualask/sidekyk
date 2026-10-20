import { useCallback, useEffect, useRef, useState } from 'react';
import type { Translator } from '@/shared/i18n';

export type CopyState = { id: string; ok: boolean } | null;

/** What a copy control says: `idle` until used, then whether it worked. */
export function copyLabel(copied: CopyState, idle: string, i18n: Translator): string {
    if (!copied) return idle;
    return i18n.t(copied.ok ? 'copy.done' : 'copy.failed');
}

/**
 * Copies text and remembers, for a moment, which item was copied and whether it worked, so the
 * item can show its own confirmation.
 */
export function useCopyToClipboard(resetMs = 1400) {
    const [state, setState] = useState<CopyState>(null);
    const timer = useRef<number | undefined>(undefined);

    useEffect(() => () => window.clearTimeout(timer.current), []);

    const copy = useCallback(
        async (id: string, text: string) => {
            let ok = true;
            try {
                await navigator.clipboard.writeText(text);
            } catch {
                ok = false;
            }
            window.clearTimeout(timer.current);
            setState({ id, ok });
            timer.current = window.setTimeout(() => setState(null), resetMs);
        },
        [resetMs],
    );

    return { copied: state, copy };
}
