import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from '@/shared/i18n';
import { hasShortcutModifier } from '@/shared/platform/shortcut';
import type { NoteActions } from '../../../application/note-actions/note-actions';
import { onNoteFieldKey, useNotesSettings } from '../../../application/notes-settings';
import type { Note } from '../../../model/notes.types';
import { autosize, fitLines, linesClass } from '../../notes-layout';
import { useReferenceField } from '../../references/use-reference-field';
import { useTextSaving } from './use-text-saving';

/**
 * A note's text being edited: saved as typing pauses and on close, which an empty text deletes;
 * its files and addresses tinted, a file suggested after `@` (`useReferenceField`).
 */
export function NoteEditor({
    book,
    note,
    actions,
    onClose,
}: {
    book: string;
    note: Note;
    actions: NoteActions;
    onClose: () => void;
}) {
    const [text, setText] = useState(note.text);
    const settings = useNotesSettings();
    const { t } = useTranslation();
    // long lines wrap or not as the setting says (`⌥Z` switches it), the height following
    useLayoutEffect(() => fitLines(field.current, settings.lines), [settings.lines]);
    const field = useRef<HTMLTextAreaElement>(null);
    const saving = useTextSaving(actions, note);

    const close = () => {
        saving.close();
        onClose();
    };
    const change = (value: string) => {
        setText(value);
        saving.typed(value);
    };
    const references = useReferenceField({ book, field, text, onText: change });

    useEffect(() => {
        const element = field.current;
        if (!element) return;
        autosize(element);
        element.focus();
        element.setSelectionRange(element.value.length, element.value.length);
    }, []);

    return (
        <>
            <textarea
                ref={field}
                value={text}
                spellCheck={false}
                aria-label={t('notes.text')}
                className={`block max-h-[60vh] w-full min-w-0 resize-none overflow-auto bg-transparent text-[13px]/[1.5] text-ui-text outline-none ${linesClass(settings.lines)}`}
                {...references.field}
                onChange={(event) => {
                    change(event.target.value);
                    autosize(event.target);
                }}
                // `Esc` blurs a field (the workspace's keys), a click outside too
                // the window losing the focus (⌘Tab to the agent's terminal) leaves the card open:
                // the focus comes back to it
                onBlur={() => {
                    references.field.onBlur();
                    if (document.hasFocus()) close();
                }}
                onKeyDown={(event) => {
                    if (references.keyDown(event)) return;
                    if (onNoteFieldKey(event, settings)) return;
                    if (event.key === 'Enter' && hasShortcutModifier(event)) {
                        event.preventDefault();
                        event.currentTarget.blur();
                    }
                }}
            />
            {references.layer}
        </>
    );
}
