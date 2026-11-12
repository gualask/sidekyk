import { useTranslation } from '@/shared/i18n';
import { useNoteEntities, useOpenEntity } from '../../../application/note-references';
import { entityParts, type NoteEntity } from '../../../model/entities';

/** The attribute that names an entity of the text shown, by its index. */
const ENTITY_ATTRIBUTE = 'data-entity';

/**
 * A note's text, closed, four lines at most: a click edits it, but on a file or address in it,
 * which it opens. Those are in the accent's color, underlined under the pointer, each saying
 * where it leads (`docs/features/note-references.md`).
 */
export function NoteText({
    book,
    text,
    done,
    onEdit,
}: {
    book: string;
    text: string;
    done: boolean;
    onEdit: () => void;
}) {
    const { t } = useTranslation();
    const entities = useNoteEntities(book, text);
    const open = useOpenEntity(book);
    return (
        <button
            type="button"
            className={`line-clamp-4 min-w-0 cursor-text text-left text-[13px]/[1.5] break-words whitespace-pre-wrap focus-visible:outline-none ${
                done ? 'text-ui-text-muted' : 'text-ui-text-secondary'
            }`}
            title={t('notes.clickToEdit')}
            onClick={(event) => {
                const entity = entityAt(event.target, entities);
                if (entity) open(entity);
                else onEdit();
            }}
        >
            {text === '' ? (
                <span className="text-ui-text-muted">{t('notes.addText')}</span>
            ) : (
                <TextParts text={text} entities={entities} />
            )}
        </button>
    );
}

/** The text in its parts: plain, or an entity in the accent's color saying where it leads. */
function TextParts({ text, entities }: { text: string; entities: readonly NoteEntity[] }) {
    const { t } = useTranslation();
    return (
        <>
            {entityParts(text, entities).map((part) => {
                if (part.kind === 'text') return <span key={part.start}>{part.text}</span>;
                if (part.kind !== 'entity') return null;
                return (
                    <span
                        key={part.start}
                        {...{ [ENTITY_ATTRIBUTE]: part.index }}
                        className="cursor-pointer text-ui-accent underline-offset-2 hover:underline"
                        title={
                            part.entity.kind === 'link'
                                ? t('notes.openLink', { url: part.entity.url })
                                : t('notes.openFile', { path: part.entity.path })
                        }
                    >
                        {part.text}
                    </span>
                );
            })}
        </>
    );
}

/** The entity of `entities` a click on the text shown landed on, if any. */
function entityAt(target: EventTarget, entities: readonly NoteEntity[]): NoteEntity | undefined {
    if (!(target instanceof Element)) return undefined;
    const index = target.closest(`[${ENTITY_ATTRIBUTE}]`)?.getAttribute(ENTITY_ATTRIBUTE);
    return index == null ? undefined : entities[Number(index)];
}
