import { type KeyboardEvent, type RefObject, useMemo } from 'react';
import { enterAction } from '../../model/capture-draft';
import type { MarkHistory } from '../../model/marks';
import type { Mark } from '../../model/notes.types';
import { MarkStage } from '../mark-editor/MarkStage';
import { type HistoryChange, onMarkKey, useMarkSession } from '../mark-editor/use-mark-session';
import { enterKeys } from './enter-keys';

/**
 * The image selected in the capture window, its marks over it (`MarkStage`), their history the
 * draft's. `⌫` takes the selected mark out, `↵` writes its text, `⌘Z`/`⇧⌘Z` undo and redo; any
 * other key goes to `onKey`, told whether a mark is selected.
 */
export function ImageEditor({
    root,
    src,
    width,
    height,
    history,
    onHistory,
    taken,
    disabled,
    onKey,
}: {
    root: RefObject<HTMLDivElement | null>;
    src: string;
    width: number;
    height: number;
    history: MarkHistory;
    onHistory: HistoryChange;
    /** The marks of the note's other images. */
    taken: readonly Mark[];
    disabled: boolean;
    onKey: (event: KeyboardEvent<HTMLDivElement>, selected: boolean) => void;
}) {
    const image = useMemo(() => ({ width, height }), [width, height]);
    const session = useMarkSession(history, onHistory, image);
    const selected = session.selected !== null && session.present[session.selected] !== undefined;

    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        // the text field's keys are its own
        if (event.target instanceof HTMLInputElement) return;
        const enter = event.key === 'Enter';
        const marks = enter
            ? enterAction('image', enterKeys(event, selected)) === 'markText'
            : true;
        if (marks && onMarkKey(event, session)) return;
        onKey(event, selected);
    };

    return (
        <div
            ref={root}
            tabIndex={-1}
            className="flex min-h-0 flex-1 flex-col outline-none"
            onKeyDown={onKeyDown}
        >
            <MarkStage
                session={session}
                src={src}
                taken={taken}
                disabled={disabled}
                onFieldEnd={() => root.current?.focus()}
            />
        </div>
    );
}
