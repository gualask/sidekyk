import type { Locale } from './locale';
import en from './messages/en.json';
import it from './messages/it.json';

/** English is the source of the keys: every other catalog has the same ones (`i18n:check`). */
type Messages = typeof en;
export type MessageKey = keyof Messages;
type OneKey = Extract<MessageKey, `${string}.one`>;
/** A message with a form by number: `<key>.one`, `<key>.other`. */
type PluralKey = OneKey extends `${infer Base}.one` ? Base : never;
type MessageValues = Readonly<Record<string, string | number>>;

const CATALOGS: Record<Locale, Messages> = { en, it };

/** The UI's text in one language, and the tag its dates and numbers are formatted with. */
export interface Translator {
    readonly locale: Locale;
    /** For `Intl`: `en-GB`, `it-IT`… (`formatTag`). */
    readonly formatTag: string;
    /** A message, its `{name}` placeholders filled from `values`. */
    t(key: MessageKey, values?: MessageValues): string;
    /** The form of a message for `count`, which also fills `{count}` unless `values` has one. */
    tp(key: PluralKey, count: number, values?: MessageValues): string;
}

function fill(template: string, values: MessageValues | undefined): string {
    if (!values) return template;
    return template.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
        name in values ? String(values[name]) : placeholder,
    );
}

export function createTranslator(locale: Locale, formatTag: string): Translator {
    const messages: Readonly<Record<string, string>> = CATALOGS[locale];
    const plurals = new Intl.PluralRules(locale);
    return {
        locale,
        formatTag,
        t: (key, values) => fill(messages[key], values),
        // a form the language has but the catalog does not (Italian `many`, for millions) takes
        // `other`
        tp: (key, count, values) =>
            fill(messages[`${key}.${plurals.select(count)}`] ?? messages[`${key}.other`], {
                count,
                ...values,
            }),
    };
}
