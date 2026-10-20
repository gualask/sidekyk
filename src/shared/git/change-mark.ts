/**
 * How a file changed, the strongest of its areas (an edit over a new file over a deletion), as the
 * tree and the palette mark it. The backend's search sends it (`ChangeMark` in
 * `src-tauri/crates/core/src/modules/search/contracts.rs`).
 */
import type { MessageKey } from '@/shared/i18n';

export type ChangeMark = 'modified' | 'added' | 'deleted';

/** The mark in words, for tooltips and hints. */
export const CHANGE_MARK_WORD: Record<ChangeMark, MessageKey> = {
    modified: 'changeMark.modified',
    added: 'changeMark.added',
    deleted: 'changeMark.deleted',
};

/** The mark's color, as VS Code's explorer: amber, green for new. */
export const CHANGE_MARK_TONE: Record<ChangeMark, string> = {
    modified: 'text-ui-warning',
    added: 'text-ui-success',
    deleted: 'text-ui-danger',
};
