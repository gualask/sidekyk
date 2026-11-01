import { IconPhoto, IconX } from '@tabler/icons-react';
import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from '@/shared/i18n';
import { shortcutLabel } from '@/shared/platform/shortcut';
import type { PendingImages } from '../application/notes.queries';
import { onNoteFieldKey, useNotesSettings } from '../application/notes-settings';
import { autosize, fitLines, linesClass } from './notes-layout';

/** Frees what pending images hold for their previews. */
function release(pending: readonly PendingImages[]) {
    for (const images of pending) {
        for (const url of images.previews) URL.revokeObjectURL(url);
    }
}

/**
 * The field on top of notes: `↵` adds the note, `⇧↵` breaks the line, a paste into the empty field
 * adds it at once. Images pasted or dropped into the empty field add a note of them at once; with
 * text there, they wait below it for `↵`. `⌘N` (the app's key) brings the focus here, as its
 * placeholder says.
 */
export function Composer({
    focus,
    onFocused,
    placeholder,
    label,
    hint,
    onAdd,
    pasted,
    dropInto,
    dropping,
}: {
    /** The field takes the focus (as it shows). */
    focus: boolean;
    onFocused: () => void;
    placeholder: string;
    label: string;
    /** A line below the field, or null. */
    hint: string | null;
    /**
     * Adds the note, its text then its images: whether a note was made, and the images left out
     * by a step that failed.
     */
    onAdd: (
        text: string,
        images: readonly PendingImages[],
    ) => Promise<{ added: boolean; left: PendingImages[] }>;
    /** Files pasted, as images to add. */
    pasted: (files: readonly File[]) => PendingImages;
    /** Where the column hands the images dropped on it, but on a card. */
    dropInto: RefObject<((images: PendingImages) => void) | null>;
    /** Files are dragged over the column, not over a card: they would come here. */
    dropping: boolean;
}) {
    const { t } = useTranslation();
    const [text, setText] = useState('');
    const [pending, setPending] = useState<PendingImages[]>([]);
    const field = useRef<HTMLTextAreaElement>(null);
    const settings = useNotesSettings();
    // long lines wrap or not as the setting says (`⌥Z` switches it), the height following
    useLayoutEffect(() => fitLines(field.current, settings.lines), [settings.lines]);
    useEffect(() => {
        if (!focus) return;
        field.current?.focus();
        onFocused();
    }, [focus, onFocused]);
    // the previews still waiting go with the field
    const waiting = useRef(pending);
    waiting.current = pending;
    useEffect(() => () => release(waiting.current), []);
    // one note at a time: a second ↵ while the first is being added adds nothing
    const adding = useRef(false);
    // the field keeps the text until a note is made of it, and the images until they are added:
    // a failure loses nothing (images that failed wait below, to try again or leave out); what
    // was typed meanwhile stays
    const add = async (value: string, images: readonly PendingImages[]) => {
        const note = value.trimEnd();
        if ((note.trim() === '' && images.length === 0) || adding.current) return;
        adding.current = true;
        const { added, left } = await onAdd(note, images);
        adding.current = false;
        release(images.filter((p) => !left.includes(p)));
        setPending((all) => [...all.filter((p) => !images.includes(p)), ...left]);
        const typed = field.current;
        if (!added || !typed || typed.value !== value) return;
        setText('');
        typed.value = '';
        autosize(typed);
    };
    // images into the empty field make a note at once; with text, they wait for ↵
    const take = (images: PendingImages) => {
        const typed = field.current?.value ?? '';
        if (typed.trim() === '' && waiting.current.length === 0) void add('', [images]);
        else setPending((all) => [...all, images]);
    };
    dropInto.current = take;

    return (
        <div className="px-3 pt-2.5 pb-1">
            <textarea
                ref={field}
                rows={1}
                value={text}
                spellCheck={false}
                placeholder={`${placeholder}  ${shortcutLabel('N')}`}
                aria-label={label}
                className={`block max-h-[132px] w-full resize-none rounded-lg border bg-ui-surface-subtle px-2.5 py-[7px] text-[13px]/[1.5] text-ui-text outline-none placeholder:text-ui-text-muted focus:border-ui-accent ${
                    dropping ? 'border-ui-accent' : 'border-ui-border'
                } ${linesClass(settings.lines)}`}
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
                    void add(text, pending);
                }}
                onPaste={(event) => {
                    // files copied (a screenshot, a file in the file manager): the backend
                    // refuses those that are not images a note takes
                    const files = [...event.clipboardData.files];
                    if (files.length > 0) {
                        event.preventDefault();
                        take(pasted(files));
                        return;
                    }
                    if (text !== '' || pending.length > 0) return;
                    const typed = event.clipboardData.getData('text/plain');
                    if (typed.trim() === '') return;
                    event.preventDefault();
                    void add(typed, []);
                }}
            />
            {pending.length > 0 ? (
                <ul className="flex flex-wrap gap-1.5 pt-1.5" aria-label={t('notes.pending')}>
                    {pending.map((images) => (
                        <PendingChip
                            key={images.previews[0] ?? images.names.join('\n')}
                            images={images}
                            onDrop={() => {
                                release([images]);
                                setPending((all) => all.filter((p) => p !== images));
                            }}
                        />
                    ))}
                </ul>
            ) : null}
            {hint ? <p className="px-0.5 pt-1 text-[11.5px] text-ui-text-muted">{hint}</p> : null}
        </div>
    );
}

/** Images waiting for `↵`: their previews when pasted, their names when dropped; × leaves them out. */
function PendingChip({ images, onDrop }: { images: PendingImages; onDrop: () => void }) {
    const { t } = useTranslation();
    const name = images.names.join(', ');
    return (
        <li className="flex h-9 items-center gap-1 rounded-md bg-ui-surface-subtle pr-0.5 pl-1">
            {images.previews.length > 0 ? (
                images.previews.map((url) => (
                    <img
                        key={url}
                        src={url}
                        alt={t('notes.image')}
                        className="h-7 w-auto max-w-16 rounded object-cover"
                        draggable={false}
                    />
                ))
            ) : (
                <span className="flex min-w-0 items-center gap-1 text-xs text-ui-text-secondary">
                    <IconPhoto size={14} className="shrink-0 text-ui-text-muted" />
                    <span className="max-w-48 truncate">{name}</span>
                </span>
            )}
            <button
                type="button"
                className="btn-icon h-6 w-6"
                title={t('notes.dropPending', { name })}
                aria-label={t('notes.dropPending', { name })}
                onClick={onDrop}
            >
                <IconX size={12} />
            </button>
        </li>
    );
}
