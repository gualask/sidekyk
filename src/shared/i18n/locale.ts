/** The languages of the UI. */
const LOCALES = ['en', 'it'] as const;

export type Locale = (typeof LOCALES)[number];

/** A language tag's language alone: `en-GB` → `en`. */
function baseOf(language: string): string {
    return language.toLowerCase().split('-')[0] ?? '';
}

/** The system's first language the UI speaks, from `navigator.languages`; English otherwise. */
export function detectLocale(languages: readonly string[]): Locale {
    for (const language of languages) {
        const base = baseOf(language);
        const locale = LOCALES.find((l) => l === base);
        if (locale) return locale;
    }
    return 'en';
}

/**
 * The tag dates and numbers are formatted with: the system's own variant of the UI's language
 * (`en-GB` for English on a British system), else the language alone.
 */
export function formatTag(locale: Locale, languages: readonly string[]): string {
    return languages.find((language) => baseOf(language) === locale) ?? locale;
}
