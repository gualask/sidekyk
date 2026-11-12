import { Autocomplete } from '@base-ui/react/autocomplete';
import { IconFileSearch, IconSearch } from '@tabler/icons-react';
import { type MessageKey, useTranslation } from '@/shared/i18n';
import { withKeys } from '@/shared/platform/keys';

/** What the palette looks for: places to go by name (`⌘K`), or a text in the files (`⌘F`). */
export type PaletteMode = 'names' | 'contents';

const MODES: { mode: PaletteMode; label: MessageKey; key: string }[] = [
    { mode: 'names', label: 'common.goTo', key: 'K' },
    { mode: 'contents', label: 'common.findInFiles', key: 'F' },
];

/**
 * The palette's field, its icon telling what it looks for, and a tab per mode on its right. `Esc`
 * empties the field first, then lets the palette close.
 */
export function PaletteField({
    mode,
    onModeChange,
    query,
    onClear,
    placeholder,
}: {
    mode: PaletteMode;
    onModeChange: (mode: PaletteMode) => void;
    query: string;
    onClear: () => void;
    placeholder: string;
}) {
    const { t } = useTranslation();
    const contents = mode === 'contents';
    return (
        <div className="flex items-center gap-2.5 border-b border-ui-border pr-3 pl-[18px]">
            {contents ? (
                <IconFileSearch size={16} className="shrink-0 text-ui-text-muted" aria-hidden />
            ) : (
                <IconSearch size={16} className="shrink-0 text-ui-text-muted" aria-hidden />
            )}
            <Autocomplete.Input
                aria-label={t(contents ? 'common.findInFiles' : 'common.goTo')}
                placeholder={placeholder}
                spellCheck={false}
                autoComplete="off"
                className="h-[50px] min-w-0 flex-1 border-0 bg-transparent text-[15px] text-ui-text outline-none placeholder:text-ui-text-muted"
                onKeyDown={(event) => {
                    // Esc empties the field first, then closes the palette
                    if (event.key === 'Escape' && query) {
                        event.preventDefault();
                        event.stopPropagation();
                        onClear();
                    }
                }}
            />
            <div className="flex shrink-0 gap-0.5 rounded-md bg-ui-surface-subtle p-0.5">
                {MODES.map((choice) => (
                    <button
                        key={choice.mode}
                        type="button"
                        title={withKeys(t(choice.label), `Mod+${choice.key}`)}
                        aria-pressed={choice.mode === mode}
                        onClick={() => onModeChange(choice.mode)}
                        className={`h-6 rounded px-2 text-xs ${
                            choice.mode === mode
                                ? 'bg-ui-surface text-ui-text shadow-sm'
                                : 'text-ui-text-muted hover:text-ui-text'
                        }`}
                    >
                        {t(choice.label)}
                    </button>
                ))}
            </div>
        </div>
    );
}
