import { IconChevronDown, IconChevronUp } from '@tabler/icons-react';
import { useTranslation } from '@/shared/i18n';
import { withKeys } from '@/shared/platform/keys';
import { InlineField } from '@/shared/ui/InlineField';
import { noteTitle } from '../../model/notes';
import type { Note } from '../../model/notes.types';

/** A note's line, as tall as the virtualizer expects it. */
export const ROW_HEIGHT = 34;
/** The keys that move the note picked, as this system names them. */
export const UP = 'Alt+ArrowUp';
export const DOWN = 'Alt+ArrowDown';

/**
 * A note's line, at `start`: up, its position (a click types another), down, then its title,
 * which picks it.
 */
export function ReorderRow({
    note,
    index,
    count,
    start,
    picked,
    typing,
    onTyping,
    onPick,
    onMove,
}: {
    note: Note;
    index: number;
    count: number;
    start: number;
    picked: boolean;
    /** Its position is being typed. */
    typing: boolean;
    onTyping: (typing: boolean) => void;
    onPick: () => void;
    onMove: (to: number) => void;
}) {
    const { t } = useTranslation();
    return (
        <div
            className={`absolute top-0 left-0 flex w-full items-center gap-2 rounded-lg border py-0.5 pr-2.5 pl-1 ${
                picked
                    ? 'border-ui-accent bg-ui-accent-soft'
                    : 'border-ui-border bg-ui-surface-subtle'
            }`}
            style={{ height: ROW_HEIGHT, transform: `translateY(${start}px)` }}
        >
            <span className="flex shrink-0 items-center">
                <button
                    type="button"
                    className="btn-icon h-6 w-6"
                    disabled={index === 0}
                    title={withKeys(t('reorder.up'), UP)}
                    aria-label={t('reorder.up')}
                    onClick={() => onMove(index - 1)}
                >
                    <IconChevronUp size={13} />
                </button>
                <Position
                    index={index}
                    count={count}
                    typing={typing}
                    onTyping={onTyping}
                    onMove={onMove}
                />
                <button
                    type="button"
                    className="btn-icon h-6 w-6"
                    disabled={index === count - 1}
                    title={withKeys(t('reorder.down'), DOWN)}
                    aria-label={t('reorder.down')}
                    onClick={() => onMove(index + 1)}
                >
                    <IconChevronDown size={13} />
                </button>
            </span>
            <button
                type="button"
                className="h-full min-w-0 flex-1 truncate text-left text-[13px] text-ui-text-secondary focus-visible:outline-none"
                aria-pressed={picked}
                onClick={onPick}
            >
                {noteTitle(note.text)}
            </button>
        </div>
    );
}

/** A note's position, a click types another (`typing`), which moves it there. */
function Position({
    index,
    count,
    typing,
    onTyping,
    onMove,
}: {
    index: number;
    count: number;
    typing: boolean;
    onTyping: (typing: boolean) => void;
    onMove: (to: number) => void;
}) {
    const { t } = useTranslation();
    if (typing) {
        return (
            <PositionInput
                position={index + 1}
                count={count}
                onEnd={(to) => {
                    onTyping(false);
                    if (to !== null) onMove(to - 1);
                }}
            />
        );
    }
    return (
        <button
            type="button"
            className="h-6 min-w-8 rounded-md px-1 font-mono text-xs text-ui-text-secondary hover:bg-ui-surface-hover"
            title={t('reorder.typePosition', { count })}
            aria-label={t('reorder.positionOf', { position: index + 1, count })}
            onClick={() => onTyping(true)}
        >
            {index + 1}
        </button>
    );
}

/** A position typed in: `↵` or leaving the field moves the note there, `Esc` leaves it. */
function PositionInput({
    position,
    count,
    onEnd,
}: {
    position: number;
    count: number;
    onEnd: (position: number | null) => void;
}) {
    const { t } = useTranslation();
    return (
        <InlineField
            initial={String(position)}
            onEnd={(typed) => {
                const value = typed === null ? Number.NaN : Number.parseInt(typed, 10);
                onEnd(Number.isFinite(value) && value >= 1 ? Math.min(value, count) : null);
            }}
            type="number"
            min={1}
            max={count}
            aria-label={t('reorder.position')}
            className="h-6 w-12 rounded-md border border-ui-accent bg-ui-surface px-1 text-center font-mono text-xs outline-none"
        />
    );
}
