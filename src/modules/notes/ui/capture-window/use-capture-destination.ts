import { useEffect, useRef } from 'react';
import type { CaptureWhere } from '../../application/captures';
import { useNotes } from '../../application/notes.queries';
import { type CaptureDraft, chipsPlace, placeState } from '../../model/capture-draft';
import type { MoveSubject } from '../../model/destination';
import { type Destination, useDestination } from '../destination-field/use-destination';

/** What a capture's new note is, for the destination field: a note being written. */
const NEW_NOTE: MoveSubject = { kind: 'new' };

/**
 * The destination field of a draft going to a place: on that place once its book's lists are
 * read (a list chosen by name needs them), then as the user chooses.
 */
export function useCaptureDestination(draft: CaptureDraft, live: boolean): Destination {
    const destination = useDestination(NEW_NOTE);
    const place = draft.destination.kind === 'place' ? draft.destination.place : null;
    const { data } = useNotes(place?.book ?? '', place !== null);
    const placed = useRef(false);
    const { books, setState } = destination;
    useEffect(() => {
        if (!live || !place || placed.current || (place.list !== null && !data)) return;
        placed.current = true;
        setState(placeState(place, books, data?.lists));
    }, [live, place, data, books, setState]);
    return destination;
}

/** Where the draft's note goes: the note it is for, or the field's chips; none without a book. */
export function whereTo(draft: CaptureDraft, destination: Destination): CaptureWhere | null {
    const goes = draft.destination;
    if (goes.kind === 'note') return { kind: 'note', book: goes.book, note: goes.note };
    const place = chipsPlace(destination.state);
    return place ? { kind: 'new', ...place } : null;
}
