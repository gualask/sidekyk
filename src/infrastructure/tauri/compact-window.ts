import { invoke } from '@tauri-apps/api/core';
import type { CompactPhase, CompactWindowPort } from '@/shared/platform/compact-window';
import { onTauriEvent } from './events';

/** `src-tauri/src/desktop/compact_window.rs`. */
const EVENT = 'compact-window';

/** Tells the backend without waiting: the window is its, and a failure there is logged there. */
function tell(command: string): void {
    invoke(command).catch(() => undefined);
}

export const tauriCompactWindow: CompactWindowPort = {
    onPhase: (listener) => onTauriEvent<CompactPhase>(EVENT, listener),
    shown: () => tell('compact_shown'),
    close: () => tell('close_compact'),
    restored: () => tell('compact_restored'),
};
