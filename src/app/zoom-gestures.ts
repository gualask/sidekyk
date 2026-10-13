import { useEffect, useEffectEvent } from 'react';
import { hasShortcutModifier, SHORTCUT_MODIFIER } from '@/shared/platform/shortcut';

/** How far the wheel turns before a zoom, and how long until the next one. */
const WHEEL_STEP = 60;
const WHEEL_PAUSE_MS = 450;
/** How far fingers pinch apart or together before a zoom. */
const PINCH_IN = 1.25;
const PINCH_OUT = 0.8;

/** WebKit's pinch on a trackpad (`gesturechange`), on macOS. */
interface GestureEvent extends UIEvent {
    scale: number;
}

/**
 * `⌘` (`Ctrl`) + scroll and a trackpad pinch zoom in on the element under the pointer, or out.
 *
 * The wheel is listened to only while the modifier is held: a wheel listener that may cancel
 * scrolling makes every scroll of the page wait for the main thread. A pinch arrives as WebKit's
 * gesture events on macOS, which scrolling does not wait for; on Linux and Windows it would need
 * that wheel listener all the time, so it does not zoom there.
 */
export function useZoomGestures({
    zoomInAt,
    zoomOut,
}: {
    /** Zooms in on what is under the pointer, or on what is selected. */
    zoomInAt: (target: EventTarget | null) => void;
    zoomOut: () => void;
}) {
    const zoom = useEffectEvent((inward: boolean, target: EventTarget | null) => {
        if (inward) zoomInAt(target);
        else zoomOut();
    });

    useEffect(() => {
        let turned = 0;
        let pausedUntil = 0;
        function onWheel(event: WheelEvent) {
            if (!hasShortcutModifier(event)) return;
            event.preventDefault();
            if (event.timeStamp < pausedUntil) return;
            turned += event.deltaY;
            if (Math.abs(turned) < WHEEL_STEP) return;
            zoom(turned < 0, event.target);
            turned = 0;
            pausedUntil = event.timeStamp + WHEEL_PAUSE_MS;
        }

        let listening = false;
        const listen = (on: boolean) => {
            if (on === listening) return;
            listening = on;
            if (on) window.addEventListener('wheel', onWheel, { passive: false });
            else window.removeEventListener('wheel', onWheel);
        };
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === SHORTCUT_MODIFIER) listen(true);
        };
        const onKeyUp = (event: KeyboardEvent) => {
            if (event.key === SHORTCUT_MODIFIER) listen(false);
        };
        const onBlur = () => listen(false);

        // one zoom per pinch; the page itself never magnifies
        let pinched = false;
        const onGestureStart = (event: Event) => {
            event.preventDefault();
            pinched = false;
        };
        const onGestureChange = (event: Event) => {
            event.preventDefault();
            const { scale, target } = event as GestureEvent;
            if (pinched || (scale < PINCH_IN && scale > PINCH_OUT)) return;
            pinched = true;
            zoom(scale >= PINCH_IN, target);
        };

        window.addEventListener('keydown', onKeyDown);
        window.addEventListener('keyup', onKeyUp);
        window.addEventListener('blur', onBlur);
        window.addEventListener('gesturestart', onGestureStart);
        window.addEventListener('gesturechange', onGestureChange);
        return () => {
            listen(false);
            window.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('keyup', onKeyUp);
            window.removeEventListener('blur', onBlur);
            window.removeEventListener('gesturestart', onGestureStart);
            window.removeEventListener('gesturechange', onGestureChange);
        };
    }, []);
}
