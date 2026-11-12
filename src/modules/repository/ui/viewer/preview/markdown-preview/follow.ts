import type { MouseEvent } from 'react';

/** A click on a link: the app follows it, never the WebView, and no link around it. */
export function follow(event: MouseEvent, action: () => void) {
    event.preventDefault();
    event.stopPropagation();
    if (event.button === 0) action();
}
