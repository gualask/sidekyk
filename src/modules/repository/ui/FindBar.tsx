import { IconChevronDown, IconChevronUp, IconSearch, IconX } from '@tabler/icons-react';
import { useEffect, useRef } from 'react';

const ICON_BUTTON = 'btn-icon h-[24px] w-[24px]';

/**
 * The text looked for in the file shown, as a browser's find bar: where the match being read is
 * among them all, and the way through them. `↵` goes to the next, `⇧↵` to the previous, `Esc`
 * closes the bar; the text can be changed in place.
 */
export function FindBar({
    query,
    count,
    current,
    onQuery,
    onStep,
    onClose,
}: {
    query: string;
    count: number;
    /** The match being read, from 0. */
    current: number;
    onQuery: (query: string) => void;
    onStep: (step: -1 | 1) => void;
    onClose: () => void;
}) {
    // the bar opens to be read through, and typed in, at once
    const field = useRef<HTMLInputElement>(null);
    useEffect(() => field.current?.focus(), []);

    return (
        <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-ui-border bg-ui-surface px-3">
            <IconSearch size={14} className="shrink-0 text-ui-text-muted" aria-hidden />
            <input
                ref={field}
                aria-label="Find in file"
                value={query}
                spellCheck={false}
                autoComplete="off"
                onChange={(event) => onQuery(event.target.value)}
                onKeyDown={(event) => {
                    if (event.key === 'Enter') onStep(event.shiftKey ? -1 : 1);
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
                title="Close (Esc)"
                aria-label="Close"
                onClick={onClose}
            >
                <IconX size={15} />
            </button>
        </div>
    );
}
