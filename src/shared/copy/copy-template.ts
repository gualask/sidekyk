/**
 * What a copy from a diff puts on the clipboard, as the user writes it in the settings:
 * `{row}` becomes where the text is (`src/cart.ts:14`, `src/cart.ts:12-15`) and `{text}` the text
 * copied. The backend keeps it (`CopyTemplate` in `src-tauri/src/modules/settings/contracts.rs`).
 */

/** Where, then what, with no formatting that could break where it is pasted. */
export const DEFAULT_COPY_TEMPLATE = '{row}\n{text}';

const PLACEHOLDER = /\{(row|text)\}/g;

/** A template copies something only with a placeholder: the same text whatever is clicked otherwise. */
export function isCopyTemplate(template: string): boolean {
    return template.includes('{row}') || template.includes('{text}');
}

/** The template with its placeholders filled, once: a `{row}` inside the text stays as it is. */
export function fillCopyTemplate(template: string, values: { row: string; text: string }): string {
    return template.replace(PLACEHOLDER, (_, name: 'row' | 'text') => values[name]);
}
