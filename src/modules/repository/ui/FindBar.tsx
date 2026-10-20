import {
    IconChevronDown,
    IconChevronUp,
    IconFileSearch,
    IconSearch,
    IconX,
} from '@tabler/icons-react';
import { type RefObject, useEffect } from 'react';
import { useTranslation } from '@/shared/i18n';
import { shortcutKey, shortcutLabel } from '@/shared/platform/shortcut';
import { FIND_BAR_HEIGHT, FIND_BAR_INSET } from './diff-layout';

const ICON_BUTTON = 'btn-icon h-[24px] w-[24px]';

/**
 * The text looked for in the file shown, as VS Code's find widget: a card floating over the
 * viewer's top right corner (its scrollbar, the map, is beside it), with where the match being read is among
 * them all and the way through them. `↵` goes to the next, `⇧↵` to the previous, `Esc` closes
 * the bar; the text can be changed in place, or looked for in all the project's files (`⌘F`,
 * or its icon).
 */
export function FindBar({
    field,
    query,
    count,
    current,
    onQuery,
    onStep,
    onClose,
    onFindInFiles,
}: {
    /** The field, which `⌘F` comes back to. */
    field: RefObject<HTMLInputElement | null>;
    query: string;
    count: number;
    /** The match being read, from 0. */
    current: number;
    onQuery: (query: string) => void;
    onStep: (step: -1 | 1) => void;
    onClose: () => void;
    onFindInFiles: () => void;
}) {
    // the bar opens to be read through, and typed in, at once
    useEffect(() => field.current?.focus(), [field]);
    const { t } = useTranslation();

    return (
        <div
            className="absolute z-10 flex w-[300px] max-w-[calc(100%-16px)] items-center gap-1 rounded-lg border border-ui-border-hover bg-ui-surface pr-1 pl-2.5 shadow-[0_6px_20px_var(--ui-shadow-soft)]"
            style={{
                top: FIND_BAR_INSET,
                right: FIND_BAR_INSET,
                height: FIND_BAR_HEIGHT,
            }}
        >
            <IconSearch size={14} className="shrink-0 text-ui-text-muted" aria-hidden />
            <input
                ref={field}
                aria-label={t('find.inFile')}
                value={query}
                spellCheck={false}
                autoComplete="off"
                onChange={(event) => onQuery(event.target.value)}
                onKeyDown={(event) => {
                    if (shortcutKey(event) === 'f') onFindInFiles();
                    else if (event.key === 'Enter') onStep(event.shiftKey ? -1 : 1);
                    else if (event.key === 'Escape') onClose();
                    else return;
                    event.preventDefault();
                    event.stopPropagation();
                }}
                className="h-full min-w-0 flex-1 border-0 bg-transparent font-mono text-xs text-ui-text outline-none"
            />
            <span className="shrink-0 text-xs text-ui-text-muted tabular-nums" aria-live="polite">
                {count === 0 ? t('find.none') : `${current + 1}/${count}`}
            </span>
            <button
                type="button"
                className={ICON_BUTTON}
                title={`${t('find.previous')} (⇧↵)`}
                aria-label={t('find.previous')}
                disabled={count === 0}
                onClick={() => onStep(-1)}
            >
                <IconChevronUp size={15} />
            </button>
            <button
                type="button"
                className={ICON_BUTTON}
                title={`${t('find.next')} (↵)`}
                aria-label={t('find.next')}
                disabled={count === 0}
                onClick={() => onStep(1)}
            >
                <IconChevronDown size={15} />
            </button>
            <button
                type="button"
                className={ICON_BUTTON}
                title={`${t('common.findInFiles')} (${shortcutLabel('F')})`}
                aria-label={t('common.findInFiles')}
                onClick={onFindInFiles}
            >
                <IconFileSearch size={15} />
            </button>
            <button
                type="button"
                className={ICON_BUTTON}
                title={`${t('common.close')} (Esc)`}
                aria-label={t('common.close')}
                onClick={onClose}
            >
                <IconX size={15} />
            </button>
        </div>
    );
}
