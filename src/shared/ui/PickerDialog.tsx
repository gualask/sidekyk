import { Autocomplete } from '@base-ui/react/autocomplete';
import { Dialog } from '@base-ui/react/dialog';
import type { ComponentProps, ReactNode, RefObject } from 'react';
import { RichText, useTranslation } from '@/shared/i18n';

/**
 * A dialog to pick something from a list, as the palette, Move and the folder to open are: over
 * the page, near its top, a title and what it asks (or only a label), then what the caller puts in
 * (a field, its list, `PickerKeys`).
 */
export function PickerDialog({
    open = true,
    onOpenChange,
    label,
    title,
    description,
    initialFocus,
    width,
    children,
}: {
    open?: boolean;
    onOpenChange: (open: boolean) => void;
    /** What a screen reader calls it when it has no title. */
    label?: string;
    title?: ReactNode;
    description?: ReactNode;
    /** What takes the focus as it opens: its field. */
    initialFocus?: RefObject<HTMLElement | null>;
    /** Its width, as a class: `w-[min(520px,calc(100vw-32px))]`. */
    width: string;
    children: ReactNode;
}) {
    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Portal>
                <Dialog.Backdrop className="dialog-backdrop" />
                <Dialog.Popup
                    aria-label={label}
                    initialFocus={initialFocus}
                    className={`dialog-popup top-[14vh] flex flex-col overflow-hidden ${width}`}
                >
                    {title ? (
                        <div className="px-4 pt-3.5">
                            <Dialog.Title className="text-[15px] font-bold">{title}</Dialog.Title>
                            {description ? (
                                <Dialog.Description className="truncate text-xs text-ui-text-muted">
                                    {description}
                                </Dialog.Description>
                            ) : null}
                        </div>
                    ) : null}
                    {children}
                </Dialog.Popup>
            </Dialog.Portal>
        </Dialog.Root>
    );
}

/**
 * A picker's field, in an Autocomplete under the title: a box holding what comes `before` the
 * text (a chip), then the text.
 */
export function PickerField({
    before = null,
    ...input
}: { before?: ReactNode } & ComponentProps<typeof Autocomplete.Input>) {
    return (
        <div className="mx-4 mt-3 mb-2 flex items-center gap-1.5 rounded-lg border border-ui-border bg-ui-surface-subtle px-2 focus-within:border-ui-accent">
            {before}
            <Autocomplete.Input
                spellCheck={false}
                autoComplete="off"
                className="h-9 min-w-0 flex-1 border-0 bg-transparent text-[13.5px] text-ui-text outline-none placeholder:text-ui-text-muted"
                {...input}
            />
        </div>
    );
}

/**
 * The keys a picker takes, along its bottom edge: `↑`/`↓` choose, `↵` does what `enter` says
 * (a text with `{enter}`), `Esc` closes; then `children`, such as a key of its own or a status.
 */
export function PickerKeys({ enter, children = null }: { enter: string; children?: ReactNode }) {
    const { t } = useTranslation();
    return (
        <div className="dialog-foot">
            <span>
                <RichText
                    text={t('common.keysChoose')}
                    parts={{ up: <kbd className="kbd">↑</kbd>, down: <kbd className="kbd">↓</kbd> }}
                />
            </span>
            <span>
                <RichText text={enter} parts={{ enter: <kbd className="kbd">↵</kbd> }} />
            </span>
            <span>
                <RichText
                    text={t('common.escCloses')}
                    parts={{ esc: <kbd className="kbd">Esc</kbd> }}
                />
            </span>
            {children}
        </div>
    );
}
