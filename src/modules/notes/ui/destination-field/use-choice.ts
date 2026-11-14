import { useEffect, useRef, useState } from 'react';
import { type MoveState, settled } from '../../model/destination';
import type { Destination } from './use-destination';

/**
 * A choice of the destination, while its field has the focus (`start`, `end`); `restore` puts back
 * the destination as it was when it took it (`Esc`). Ended, a destination left half chosen goes
 * back as it was, or to a project with the list it opens on. Closing the view (`open` false)
 * ends a choice in progress: a field hidden with the focus may never say it lost it (a shortcut
 * closes the view from anywhere).
 */
export function useChoice(open: boolean, { state, setState, chipNotes }: Destination) {
    const [choosing, setChoosing] = useState(false);
    const before = useRef<MoveState>(state);
    const [wasOpen, setWasOpen] = useState(open);
    if (open !== wasOpen) {
        setWasOpen(open);
        if (!open) setChoosing(false);
    }
    useEffect(() => {
        if (choosing) return;
        const next = settled(state, before.current, chipNotes);
        if (next !== state) setState(next);
    }, [choosing, state, chipNotes, setState]);
    return {
        choosing,
        start: () => {
            before.current = state;
            setChoosing(true);
        },
        end: () => setChoosing(false),
        restore: () => setState(before.current),
    };
}
