import { IconPhoto, IconScreenshot, IconX } from '@tabler/icons-react';
import { type RefObject, useEffect, useLayoutEffect, useRef } from 'react';
import { useTranslation } from '@/shared/i18n';
import { keysLabel } from '@/shared/platform/keys';
import { useNotesPort } from '../application/notes.port';
import { type PendingImages, useCanCapture } from '../application/notes.queries';
import { useNotesSettings } from '../application/notes-settings';
import { autosize, fitLines, linesClass } from './notes-layout';
import { useNoteDraft } from './use-note-draft';
import { useReferenceField } from './use-reference-field';

/**
 * The field on top of notes: `↵` adds the note, `⇧↵` breaks the line, a paste into the empty field
 * adds it at once; images as `useNoteDraft` says, files and addresses as `useReferenceField`.
 * `⌘N` (the app's key) brings the focus here, as its placeholder says. Where the system captures,
 * an icon at its right starts a capture, which becomes a note of its own.
 */
export function Composer({
    book,
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
    /** The book the notes go into, whose files it suggests after `@`. */
    book: string;
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
    const port = useNotesPort();
    const canCapture = useCanCapture();
    const field = useRef<HTMLTextAreaElement>(null);
    const settings = useNotesSettings();
    const draft = useNoteDraft({ field, onAdd, pasted, dropInto, onCleared: autosize });
    const references = useReferenceField({
        book,
        field,
        text: draft.field.value,
        onText: draft.setText,
    });
    // long lines wrap or not as the setting says (`⌥Z` switches it), the height following
    useLayoutEffect(() => fitLines(field.current, settings.lines), [settings.lines]);
    useEffect(() => {
        if (!focus) return;
        field.current?.focus();
        onFocused();
    }, [focus, onFocused]);

    return (
        <div className="relative px-3 pt-2.5 pb-1">
            <textarea
                ref={field}
                rows={1}
                spellCheck={false}
                placeholder={`${placeholder}  ${keysLabel('Mod+KeyN')}`}
                aria-label={label}
                className={`block max-h-[132px] w-full resize-none rounded-lg border bg-ui-surface-subtle py-[7px] pl-2.5 text-[13px]/[1.5] text-ui-text outline-none placeholder:text-ui-text-muted focus:border-ui-accent ${
                    canCapture ? 'pr-9' : 'pr-2.5'
                } ${dropping ? 'border-ui-accent' : 'border-ui-border'} ${linesClass(settings.lines)}`}
                {...draft.field}
                {...references.field}
                onChange={(event) => {
                    draft.field.onChange(event);
                    autosize(event.target);
                }}
                onKeyDown={(event) => {
                    if (!references.keyDown(event)) draft.field.onKeyDown(event);
                }}
            />
            {references.layer}
            {canCapture ? (
                <button
                    type="button"
                    className="btn-icon absolute top-[13px] right-4 h-7 w-7"
                    title={t('notes.capture')}
                    aria-label={t('notes.capture')}
                    onClick={() => void port.startCapture()}
                >
                    <IconScreenshot size={16} />
                </button>
            ) : null}
            <PendingList pending={draft.pending} onDrop={draft.dropPending} />
            {hint ? <p className="px-0.5 pt-1 text-[11.5px] text-ui-text-muted">{hint}</p> : null}
        </div>
    );
}

/** The images waiting below a field for `↵`, if any. */
export function PendingList({
    pending,
    onDrop,
}: {
    pending: readonly PendingImages[];
    onDrop: (images: PendingImages) => void;
}) {
    const { t } = useTranslation();
    if (pending.length === 0) return null;
    return (
        <ul className="flex flex-wrap gap-1.5 pt-1.5" aria-label={t('notes.pending')}>
            {pending.map((images) => (
                <PendingChip
                    key={images.previews[0] ?? images.names.join('\n')}
                    images={images}
                    onDrop={() => onDrop(images)}
                />
            ))}
        </ul>
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
