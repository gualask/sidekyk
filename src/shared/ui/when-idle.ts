/**
 * Runs `work` once the window has nothing better to do, after the first paint. WebKit has no
 * `requestIdleCallback`, so there it runs after a short delay. Returns a canceller.
 */
export function whenIdle(work: () => void): () => void {
    if ('requestIdleCallback' in window) {
        const id = window.requestIdleCallback(work, { timeout: 2000 });
        return () => window.cancelIdleCallback(id);
    }
    const id = setTimeout(work, 500);
    return () => clearTimeout(id);
}
