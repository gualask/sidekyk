import { useState } from 'react';

/**
 * The element a preview's link named in the file it leads to (`file.md#install`), for that file
 * to open on, until another file shows.
 */
export function useLinkedAnchor(shown: string | null): {
    anchorFor: (path: string) => string | null;
    link: (path: string, anchor: string | null) => void;
} {
    const [linked, setLinked] = useState<{ file: string; anchor: string } | null>(null);
    // another file shows: the element named was in the one before
    if (linked && linked.file !== shown) setLinked(null);
    return {
        anchorFor: (path) => (linked?.file === path ? linked.anchor : null),
        link: (path, anchor) => setLinked(anchor === null ? null : { file: path, anchor }),
    };
}
