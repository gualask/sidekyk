import {
    IconChevronDown,
    IconChevronUp,
    IconFileSearch,
    IconSearch,
    IconX,
} from '@tabler/icons-react';
import { type RefObject, useEffect } from 'react';
import { shortcutKey, shortcutLabel } from '@/shared/platform/shortcut';
import { FIND_BAR_HEIGHT, FIND_BAR_INSET } from './diff-layout';

const ICON_BUTTON = 'btn-icon h-[24px] w-[24px]';

/**
 * The text looked for in the file shown, as VS Code's find widget: a card floating over the
 * viewer's top right corner (`right` past its scrollbar), with where the match being read is among
 * them all and the way through them. `↵` goes to the next, `⇧↵` to the previous, `Esc` closes
 * the bar; the text can be changed in place, or looked for in all the project's files (`⌘F`,
 * or its icon).
 */
export function FindBar({
    field,
    right,
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
    /** Where the viewer's scrollbar starts, from its right edge. */
    right: number;
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

    return (
        <div
            className="absolute z-10 flex w-[300px] max-w-[calc(100%-16px)] items-center gap-1 rounded-lg border border-ui-border-hover bg-ui-surface pr-1 pl-2.5 shadow-[0_6px_20px_var(--ui-shadow-soft)]"
            style={{
                top: FIND_BAR_INSET,
                right: right + FIND_BAR_INSET,
                height: FIND_BAR_HEIGHT,
            }}
        >
            <IconSearch size={14} className="shrink-0 text-ui-text-muted" aria-hidden />
            <input
                ref={field}
                aria-label="Find in file"
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
                {count === 0 ? 'No results' : `${current + 1}/${count}`}
            </span>
            <button
                type="button"
                className={ICON_BUTTON}
                title="Previous match (⇧↵)"
                aria-label="Previous match"
                disabled={count === 0}
                onClick={() => onStep(-1)}
            >
                <IconChevronUp size={15} />
            </button>
            <button
                type="button"
                className={ICON_BUTTON}
                title="Next match (↵)"
                aria-label="Next match"
                disabled={count === 0}
                onClick={() => onStep(1)}
            >
                <IconChevronDown size={15} />
            </button>
            <button
                type="button"
                className={ICON_BUTTON}
                title={`Find in files (${shortcutLabel('F')})`}
                aria-label="Find in files"
                onClick={onFindInFiles}
            >
                <IconFileSearch size={15} />
            </button>
            <button
                type="button"
                className={ICON_BUTTON}
                title="Close (Esc)"
                aria-label="Close"
                onClick={onClose}
            >
                <IconX size={15} />
            </button>
        </div>
    );
}
