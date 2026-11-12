import { useMemo, useState } from 'react';
import { useTranslation } from '@/shared/i18n';
import { useRanking } from '@/shared/ui/hooks/use-ranking';
import { useMoveTargets } from '../../application/move-targets';
import { useNotes } from '../../application/notes.queries';
import {
    chipProject,
    initialMove,
    type MoveRow,
    type MoveState,
    type MoveSubject,
    moveBooks,
    moveRows,
    moveStep,
    namesShared,
    stepNames,
} from '../../model/destination';
import { INBOX_BOOK } from '../../model/notes.types';

/**
 * Where something goes, as a field chooses it (`../../model/destination.ts`): its chips, what is
 * typed, the suggestions, and the lists of the chip's project once read. For `DestinationField`.
 */
export function useDestination(subject: MoveSubject) {
    const { projects, rank } = useMoveTargets();
    const { t } = useTranslation();
    const books = useMemo(
        () => moveBooks(subject, projects, t('inbox.title')),
        [subject, projects, t],
    );
    const shared = useMemo(() => namesShared(books), [books]);
    const [state, setState] = useState<MoveState>(() => initialMove(subject, books));
    // the suggestion Base UI highlights, as it says (it says again whenever the rows change)
    const [highlighted, setHighlighted] = useState<MoveRow | null>(null);
    // the lists of the chip's project; the Inbox's are never picked
    const project = chipProject(state);
    const { data } = useNotes(project ?? INBOX_BOOK, project !== null);
    const chipNotes = project ? data : undefined;
    // the same step, and names to rank, while only the typing changes
    const { chip, list } = state;
    const step = useMemo(
        () => moveStep(subject, { chip, list }, books, chipNotes),
        [subject, chip, list, books, chipNotes],
    );
    const names = useMemo(() => stepNames(step), [step]);
    const { order, pending } = useRanking(rank, state.query, names);
    const rows = useMemo(() => moveRows(step, state.query, order), [step, state.query, order]);
    return {
        subject,
        books,
        shared,
        state,
        setState,
        /** Back to the chip it started with. */
        reset: () => setState(initialMove(subject, books)),
        chipNotes,
        rows,
        /** The rows do not answer what is typed yet: `↵` waits for them. */
        pending,
        /** The suggestion chosen with `↑`/`↓` or typing, if any. */
        highlighted,
        setHighlighted,
    };
}

export type Destination = ReturnType<typeof useDestination>;
