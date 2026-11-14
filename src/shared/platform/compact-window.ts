/** What the compact window shows: the quick note, or the capture window. */
export type CompactView = 'quickNote' | 'capture';

/**
 * What the backend asks of the page: a view shown, in a box of `width` x `height` (the window's
 * size, unless it cannot shrink), the layout back, or the window asked to close (`⌘W`), which the
 * view ends as at `Esc`.
 */
export type CompactPhase =
    | { kind: 'open'; view: CompactView; width: number; height: number }
    | { kind: 'close' }
    | { kind: 'closeAsked' };

/**
 * The compact window: the window shrunk to one view over any app (the quick note, the capture
 * window), opened by a global shortcut, the tray or a capture, then back as it was. The window stays transparent until the page
 * says it painted what it shows, since a hidden page never paints and a window shown before would
 * show the frame before (`src-tauri/src/desktop/compact_window.rs`).
 */
export interface CompactWindowPort {
    /** Called at each phase the backend asks for. Returns a synchronous disposer. */
    onPhase(listener: (phase: CompactPhase) => void): () => void;
    /** The page painted the view. */
    shown(): void;
    /** The view is done, kept or not: the window goes back as it was, then `close`. */
    close(): void;
    /** The page painted its layout again. */
    restored(): void;
}
