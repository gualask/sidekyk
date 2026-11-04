import { IconInbox } from '@tabler/icons-react';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { RichText, useTranslation } from '@/shared/i18n';
import { useNoteActions, useNotes } from '../application/notes.queries';
import { useNotesSettings } from '../application/notes-settings';
import { INBOX_BOOK } from '../model/notes.types';
import { PendingList } from './Composer';
import { linesClass, wrapLines } from './notes-layout';
import { useColumnImages } from './use-image-drops';
import { useNoteDraft } from './use-note-draft';

/**
 * The quick note: the window shrunk to a field for the Inbox, over any app. The field fills it, a
 * line below says where the note goes and which keys do what. `↵` adds the note and closes, as a
 * paste into the empty field does; images pasted or dropped after text wait for `↵`. `Esc` closes
 * and keeps what was typed for the next time. In a window larger than itself (full screen) it
 * sits in the middle.
 */
export function QuickNote({ open, onDone }: { open: boolean; onDone: () => void }) {
    const { t } = useTranslation();
    const { data: notes } = useNotes(INBOX_BOOK);
    const actions = useNoteActions(INBOX_BOOK);
    const settings = useNotesSettings();
    const box = useRef<HTMLElement>(null);
    const field = useRef<HTMLTextAreaElement>(null);
    // the Inbox's one list, made with it
    const list = notes?.lists[0]?.id;
    const images = useColumnImages({
        root: box,
        book: INBOX_BOOK,
        actions,
        list: list ?? '',
        onAdded: onDone,
    });
    const draft = useNoteDraft({
        field,
        // until the Inbox is read, a note has nowhere to go: it waits in the field
        onAdd: (text, pending) =>
            list
                ? images.composer.onAdd(text, pending)
                : Promise.resolve({ added: false, left: [...pending] }),
        pasted: images.composer.pasted,
        dropInto: images.composer.dropInto,
    });
    // long lines wrap or not as the setting says (`⌥Z` switches it); the field keeps its height
    useLayoutEffect(() => wrapLines(field.current, settings.lines), [settings.lines]);
    useEffect(() => {
        if (open) field.current?.focus();
    }, [open]);

    return (
        <main
            className={`h-screen w-screen items-center justify-center bg-ui-bg font-sans ${
                open ? 'flex' : 'hidden'
            }`}
            // the layout, hidden under the note, keeps its window keys: the note's are its own
            onKeyDown={(event) => event.stopPropagation()}
        >
            {/* the window's size as the backend makes it (`quick_note.rs`), for a larger one */}
            <section
                ref={box}
                className="flex h-[min(100vh,168px)] w-full max-w-[560px] flex-col bg-ui-surface min-[600px]:rounded-xl"
            >
                <div className="flex min-h-0 flex-1 flex-col px-4 pt-3.5 pb-2">
                    <textarea
                        ref={field}
                        spellCheck={false}
                        placeholder={t('quickNote.placeholder')}
                        aria-label={t('inbox.newNote')}
                        className={`min-h-0 flex-1 resize-none bg-transparent text-[15px]/[1.5] text-ui-text outline-none placeholder:text-ui-text-muted ${linesClass(settings.lines)}`}
                        {...draft.field}
                        onKeyDown={(event) => {
                            if (event.key === 'Escape') {
                                event.preventDefault();
                                onDone();
                                return;
                            }
                            draft.field.onKeyDown(event);
                        }}
                    />
                    <PendingList pending={draft.pending} onDrop={draft.dropPending} />
                </div>
                <div className="dialog-foot items-center">
                    <span className="mr-auto flex items-center gap-1.5 text-ui-text-secondary">
                        <IconInbox size={14} />
                        {t('inbox.title')}
                    </span>
                    <span>
                        <RichText
                            text={t('quickNote.add')}
                            parts={{ enter: <kbd className="kbd">↵</kbd> }}
                        />
                    </span>
                    <span>
                        <RichText
                            text={t('quickNote.newLine')}
                            parts={{ keys: <kbd className="kbd">⇧↵</kbd> }}
                        />
                    </span>
                    <span>
                        <RichText
                            text={t('common.escCloses')}
                            parts={{ esc: <kbd className="kbd">Esc</kbd> }}
                        />
                    </span>
                </div>
            </section>
        </main>
    );
}
