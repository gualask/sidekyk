import { invoke } from '@tauri-apps/api/core';
import type { QuickNotePhase, QuickNotePort } from '@/shared/platform/quick-note';
import { onTauriEvent } from './events';

/** `src-tauri/src/desktop/quick_note.rs`. */
const EVENT = 'quick-note';

/** Tells the backend without waiting: the window is its, and a failure there is logged there. */
function tell(command: string): void {
    invoke(command).catch(() => undefined);
}

export const tauriQuickNote: QuickNotePort = {
    onPhase: (listener) => onTauriEvent<QuickNotePhase>(EVENT, listener),
    shown: () => tell('quick_note_shown'),
    close: () => tell('close_quick_note'),
    restored: () => tell('quick_note_restored'),
};
