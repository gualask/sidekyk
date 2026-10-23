import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { shortcutLabel } from '@/shared/platform/shortcut';
import { onNoteFieldKey, useNotesSettings } from '../application/notes-settings';
import { autosize, fitLines, linesClass } from './notes-layout';

/**
 * The field on top of notes: `↵` adds the note, `⇧↵` breaks the line, a paste into the empty field
 * adds it at once. `⌘N` (the app's key) brings the focus here, as its placeholder says.
 */
export function Composer({
    focus,
    onFocused,
    placeholder,
    label,
    hint,
    onAdd,
}: {
    /** The field takes the focus (as it shows). */
    focus: boolean;
    onFocused: () => void;
    placeholder: string;
    label: string;
    /** A line below the field, or null. */
    hint: string | null;
    /** Whether the note was added. */
    onAdd: (text: string) => Promise<boolean>;
}) {
    const [text, setText] = useState('');
    const field = useRef<HTMLTextAreaElement>(null);
    const settings = useNotesSettings();
    // long lines wrap or not as the setting says (`⌥Z` switches it), the height following
    useLayoutEffect(() => fitLines(field.current, settings.lines), [settings.lines]);
    useEffect(() => {
        if (!focus) return;
        field.current?.focus();
        onFocused();
    }, [focus, onFocused]);
    // one note at a time: a second ↵ while the first is being added adds nothing
    const adding = useRef(false);
    // the field keeps the text until the note is added: a failure loses nothing; what was typed
    // meanwhile stays
    const add = async (value: string) => {
        const note = value.trimEnd();
        if (note.trim() === '' || adding.current) return;
        adding.current = true;
        const added = await onAdd(note);
        adding.current = false;
        const typed = field.current;
        if (!added || !typed || typed.value !== value) return;
        setText('');
        typed.value = '';
        autosize(typed);
    };

    return (
        <div className="px-3 pt-2.5 pb-1">
            <textarea
                ref={field}
                rows={1}
                value={text}
                spellCheck={false}
                placeholder={`${placeholder}  ${shortcutLabel('N')}`}
                aria-label={label}
                className={`block max-h-[132px] w-full resize-none rounded-lg border border-ui-border bg-ui-surface-subtle px-2.5 py-[7px] text-[13px]/[1.5] text-ui-text outline-none placeholder:text-ui-text-muted focus:border-ui-accent ${linesClass(settings.lines)}`}
                onChange={(event) => {
                    setText(event.target.value);
                    autosize(event.target);
                }}
                onKeyDown={(event) => {
                    if (onNoteFieldKey(event, settings)) return;
                    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) {
                        return;
                    }
                    event.preventDefault();
                    void add(text);
                }}
                onPaste={(event) => {
                    if (text !== '') return;
                    const pasted = event.clipboardData.getData('text/plain');
                    if (pasted.trim() === '') return;
                    event.preventDefault();
                    void add(pasted);
                }}
            />
            {hint ? <p className="px-0.5 pt-1 text-[11.5px] text-ui-text-muted">{hint}</p> : null}
        </div>
    );
}
