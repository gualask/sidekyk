import { RichText } from '@/shared/i18n';
import { keysLabel } from '@/shared/platform/keys';

/** A combination as a key cap, as this system writes it (`shared/platform/keys.ts`). */
export function KeyCap({ keys }: { keys: string }) {
    return <kbd className="kbd">{keysLabel(keys)}</kbd>;
}

/**
 * A text of the catalogs with its keys as key caps, each placeholder by its combination:
 * `{esc} close` with `{ esc: 'Escape' }`.
 */
export function KeyHint({ text, keys }: { text: string; keys: Record<string, string> }) {
    const parts = Object.fromEntries(
        Object.entries(keys).map(([name, combination]) => [
            name,
            <KeyCap key={name} keys={combination} />,
        ]),
    );
    return <RichText text={text} parts={parts} />;
}
