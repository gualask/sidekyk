import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { useTranslation } from '@/shared/i18n';
import { useNotesPort } from '../../application/notes.port';
import { markHistory, sameMarks } from '../../model/marks';
import { sourceImage } from '../../model/notes';
import type { Mark, NoteImage } from '../../model/notes.types';
import { DiscardDialog } from './DiscardDialog';
import { EditorHeader } from './EditorHeader';
import { MarkStage } from './MarkStage';
import { onMarkKey, useMarkSession } from './use-mark-session';

const NO_MARKS: Mark[] = [];

/**
 * Marks an image of a note, in the viewer: the image as given, fitted, with its marks over it
 * (`MarkStage`), `⌫` taking the selected one out, `⌘Z`/`⇧⌘Z` undoing and redoing. Done ends with
 * `onDone` given the marks (null when unchanged), and whether the editor may go (it stays when
 * they were not saved); Cancel or `Esc` with `onCancel`, after asking when the session changed
 * something.
 */
export function MarkEditor({
    book,
    image,
    taken,
    onDone,
    onCancel,
}: {
    book: string;
    image: NoteImage;
    /** The marks of the note's other images: a new letter comes after theirs. */
    taken: readonly Mark[];
    onDone: (marks: Mark[] | null) => Promise<boolean>;
    onCancel: () => void;
}) {
    const port = useNotesPort();
    const { t } = useTranslation();
    const initial = image.marked?.marks ?? NO_MARKS;
    const [history, setHistory] = useState(() => markHistory(initial));
    const session = useMarkSession(history, setHistory, image);
    const [saving, setSaving] = useState(false);
    // Cancel asked whether to drop what the session changed
    const [asking, setAsking] = useState(false);
    const root = useRef<HTMLDivElement>(null);

    useEffect(() => {
        root.current?.focus();
    }, []);

    const done = async () => {
        if (saving) return;
        const final = session.settled();
        setSaving(true);
        const left = await onDone(sameMarks(final, initial) ? null : final);
        if (!left) setSaving(false);
    };

    /** Leaves without keeping the session's changes: asked first when there are any. */
    const cancel = () => {
        if (saving) return;
        if (sameMarks(session.pending(), initial)) onCancel();
        else setAsking(true);
    };

    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        // the field's keys are its own, the question's too (its keys reach here through React)
        if (event.target instanceof HTMLInputElement || asking) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            cancel();
            return;
        }
        onMarkKey(event, session);
    };

    return (
        <div
            ref={root}
            tabIndex={-1}
            className="flex min-h-0 flex-1 flex-col outline-none"
            onKeyDown={onKeyDown}
        >
            <EditorHeader saving={saving} onCancel={cancel} onDone={() => void done()} />
            <MarkStage
                session={session}
                src={port.imageUrl(book, sourceImage(image), false)}
                taken={taken}
                disabled={saving}
                onFieldEnd={() => root.current?.focus()}
            />
            <DiscardDialog
                open={asking}
                title={t('notes.discardMarksTitle')}
                text={t('notes.discardMarksText')}
                keep={t('notes.keepMarking')}
                onKeep={() => setAsking(false)}
                onDiscard={() => {
                    setAsking(false);
                    onCancel();
                }}
            />
        </div>
    );
}
