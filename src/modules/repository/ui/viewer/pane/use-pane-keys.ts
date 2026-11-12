import type { RefObject } from 'react';
import { shortcutKey } from '@/shared/platform/shortcut';
import { useWindowKeys } from '@/shared/ui/hooks/use-window-keys';
import { isKeyTaken, isOwnKey } from '@/shared/ui/keys';
import type { FileFinder } from '../../../application/find';
import type { HunkReader } from '../diff/diff-list/use-hunk-reader';

/**
 * A pane's keys, before the workspace's: `⌘F` opens the find bar, or comes back to its `field`
 * (in its field the bar takes it); `Esc` closes the bar first, wherever the focus is in the panel;
 * with `onPastEnd`, `n`/`p` go through the changes, then on past the last or the first.
 */
export function usePaneKeys({
    finder,
    field,
    reader,
    onPastEnd,
}: {
    finder: FileFinder;
    field: RefObject<HTMLInputElement | null>;
    reader: RefObject<HunkReader | null>;
    onPastEnd: ((step: 1 | -1) => void) | undefined;
}) {
    const find = finder.bar;
    useWindowKeys(
        (event) => {
            if (event.defaultPrevented || isKeyTaken(event.target)) return;
            if (shortcutKey(event) === 'f') {
                event.preventDefault();
                if (find) {
                    field.current?.focus();
                    field.current?.select();
                } else finder.open();
                return;
            }
            if (!isOwnKey(event)) return;
            const change = event.key === 'n' ? 1 : event.key === 'p' ? -1 : 0;
            if (change !== 0 && onPastEnd) {
                event.preventDefault();
                if (!reader.current?.step(change)) onPastEnd(change);
                return;
            }
            if (!find || event.key !== 'Escape') return;
            event.preventDefault();
            find.onClose();
        },
        { capture: true },
    );
}
