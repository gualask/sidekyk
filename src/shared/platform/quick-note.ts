/** What the backend asks of the page: the quick note shown, or the layout back. */
export type QuickNotePhase = 'open' | 'close';

/**
 * The quick note: the window shrunk to a field for the Inbox, opened over any app by a global
 * shortcut or the tray, then back as it was. The window stays transparent until the page says it
 * painted what it shows, since a hidden page never paints and a window shown before would show
 * the frame before (`src-tauri/src/desktop/quick_note.rs`).
 */
export interface QuickNotePort {
    /** Called at each phase the backend asks for. Returns a synchronous disposer. */
    onPhase(listener: (phase: QuickNotePhase) => void): () => void;
    /** The page painted the quick note. */
    shown(): void;
    /** The quick note is done, added or not: the window goes back as it was, then `close`. */
    close(): void;
    /** The page painted its layout again. */
    restored(): void;
}
