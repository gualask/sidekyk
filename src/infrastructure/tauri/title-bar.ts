import { TauriEvent } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';

import { MACOS } from '@/shared/platform/macos';
import type { TitleBarPort } from '@/shared/platform/title-bar';
import { onTauriEvent } from './events';

/** `tauri.conf.json` asks for an overlay title bar, which only macOS has. */
const OVERLAY_TITLE_BAR = MACOS;

/** Native title bar: the traffic lights overlay the page, except in full screen. */
export const tauriTitleBar: TitleBarPort = {
    overlaid: OVERLAY_TITLE_BAR,
    onOverlaidChange: (listener) => {
        if (!OVERLAY_TITLE_BAR) return () => undefined;
        const window = getCurrentWindow();
        let overlaid: boolean = OVERLAY_TITLE_BAR;
        let checking = false;
        let resizedSince = false;
        let disposed = false;
        // entering and leaving full screen resize the window; a drag resizes it many times, so
        // one check at a time is enough, and one more if the window resized during it: the last
        // resize of a transition is never left unchecked
        const check = () => {
            checking = true;
            resizedSince = false;
            window
                .isFullscreen()
                .then((fullscreen) => {
                    if (fullscreen === !overlaid) return;
                    overlaid = !fullscreen;
                    listener(overlaid);
                })
                .catch(() => undefined)
                .finally(() => {
                    checking = false;
                    if (resizedSince && !disposed) check();
                });
        };
        const stop = onTauriEvent(TauriEvent.WINDOW_RESIZED, () => {
            if (checking) resizedSince = true;
            else check();
        });
        return () => {
            disposed = true;
            stop();
        };
    },
};
