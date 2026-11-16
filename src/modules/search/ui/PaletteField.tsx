import { Autocomplete } from '@base-ui/react/autocomplete';
import { IconFileSearch, IconSearch } from '@tabler/icons-react';
import { useTranslation } from '@/shared/i18n';
import { withKeys } from '@/shared/platform/keys';
import { PALETTE_MODE_ORDER, PALETTE_MODES, type PaletteMode } from '../model/palette-modes';

/** The field's icon: what the palette looks for. */
const MODE_ICONS: Record<PaletteMode, typeof IconSearch> = {
    names: IconSearch,
    contents: IconFileSearch,
};

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
    const Icon = MODE_ICONS[mode];
    return (
        <div className="flex items-center gap-2.5 border-b border-ui-border pr-3 pl-[18px]">
            <Icon size={16} className="shrink-0 text-ui-text-muted" aria-hidden />
            <Autocomplete.Input
                aria-label={t(PALETTE_MODES[mode].label)}
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
                {PALETTE_MODE_ORDER.map((choice) => (
                    <button
                        key={choice}
                        type="button"
                        title={withKeys(
                            t(PALETTE_MODES[choice].label),
                            `Mod+${PALETTE_MODES[choice].key.toUpperCase()}`,
                        )}
                        aria-pressed={choice === mode}
                        onClick={() => onModeChange(choice)}
                        className={`h-6 rounded px-2 text-xs ${
                            choice === mode
                                ? 'bg-ui-surface text-ui-text shadow-sm'
                                : 'text-ui-text-muted hover:text-ui-text'
                        }`}
                    >
                        {t(PALETTE_MODES[choice].label)}
                    </button>
                ))}
            </div>
        </div>
    );
}
