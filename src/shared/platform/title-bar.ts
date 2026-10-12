/**
 * Whether the system draws the window's controls over the top of the page: macOS's traffic lights
 * in an overlay title bar, except in full screen, where they hide. The top bar leaves them room.
 */
export interface TitleBarPort {
    /** The value at startup, known without waiting, so the first paint is already right. */
    readonly overlaid: boolean;
    /** Called when the value changes. Returns a synchronous disposer. */
    onOverlaidChange(listener: (overlaid: boolean) => void): () => void;
}
