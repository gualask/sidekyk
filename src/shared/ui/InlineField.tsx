import { type ComponentProps, useEffect, useRef } from 'react';

/**
 * A value typed in place, such as a name being given: focused and selected as it shows; `↵` or
 * leaving it keeps what was typed, `Esc` drops it (before the workspace's keys, which would only
 * blur it). It ends once.
 */
export function InlineField({
    initial,
    onEnd,
    ...input
}: {
    initial: string;
    /** What was typed, or null when dropped. */
    onEnd: (value: string | null) => void;
} & Omit<ComponentProps<'input'>, 'defaultValue' | 'value' | 'onKeyDown' | 'onBlur' | 'ref'>) {
    const field = useRef<HTMLInputElement>(null);
    const ended = useRef(false);
    const end = (value: string | null) => {
        if (ended.current) return;
        ended.current = true;
        onEnd(value);
    };
    useEffect(() => {
        field.current?.focus();
        field.current?.select();
    }, []);
    return (
        <input
            {...input}
            ref={field}
            defaultValue={initial}
            onKeyDown={(event) => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    end(event.currentTarget.value);
                } else if (event.key === 'Escape') {
                    event.preventDefault();
                    end(null);
                }
            }}
            onBlur={(event) => end(event.currentTarget.value)}
        />
    );
}
