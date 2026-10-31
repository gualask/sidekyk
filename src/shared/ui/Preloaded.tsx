import { type ComponentType, createElement, useState } from 'react';
import type { Preloadable } from './preloadable';

/**
 * Shows a `preloadable` component with its props. Once its chunk is loaded it renders at once:
 * `lazy` alone suspends on its first render even when the chunk is already there, which shows an
 * empty frame first (and a zoom transition would capture it).
 */
export function Preloaded<P extends object>({
    of,
    props,
}: {
    of: Preloadable<P>;
    /** Checked against the component's own props, never widening them. */
    props: NoInfer<P>;
}) {
    // chosen once for each component shown: going from the lazy one to the loaded one would mount
    // it again
    const [shown, setShown] = useState(() => choose(of));
    let current = shown;
    if (shown.of !== of) {
        current = choose(of);
        setShown(current);
    }
    return createElement(current.component, props);
}

function choose<P>(of: Preloadable<P>): { of: Preloadable<P>; component: ComponentType<P> } {
    return { of, component: of.loaded ?? of.lazy };
}
