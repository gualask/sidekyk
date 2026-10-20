import { createContext, createElement, type ReactNode, useContext } from 'react';
import { createTranslator, type Translator } from './translator';

/** English until the app provides the language of the settings: tests and fixtures read it. */
const TranslationContext = createContext<Translator>(createTranslator('en', 'en'));

export function TranslationProvider({
    value,
    children,
}: {
    value: Translator;
    children: ReactNode;
}) {
    return createElement(TranslationContext.Provider, { value }, children);
}

/** The UI's text in the language of the settings. */
export function useTranslation(): Translator {
    return useContext(TranslationContext);
}
