import { IconX } from '@tabler/icons-react';
import { type MessageKey, useTranslation } from '@/shared/i18n';
import { MACOS } from '@/shared/platform/macos';
import { altLabel, shortcutLabel } from '@/shared/platform/shortcut';
import { useWindowKeys } from '@/shared/ui/hooks/use-window-keys';
import { isKeyTaken } from '@/shared/ui/keys';
import { PALETTE_PANELS } from './panels';

/** A shortcut: what it does, and its keys, each its own key cap. */
interface Shortcut {
    label: MessageKey;
    keys: string[];
    /** Words after the keys, such as another way to do it. */
    also?: MessageKey;
}

/** In the list's order, from big moves to small; `panels`: the keys that open each panel. */
const SHORTCUTS: (Shortcut | 'panels')[] = [
    {
        label: 'shortcuts.zoom',
        keys: ['↵', 'Esc'],
        also: MACOS ? 'shortcuts.zoomAlsoMac' : 'shortcuts.zoomAlso',
    },
    { label: 'shortcuts.tiles', keys: ['←', '→'] },
    { label: 'shortcuts.list', keys: ['j', 'k'], also: 'shortcuts.listAlso' },
    { label: 'shortcuts.changes', keys: ['n', 'p'] },
    'panels',
    { label: 'shortcuts.projects', keys: ['[', ']'] },
    { label: 'shortcuts.goTo', keys: [shortcutLabel('K')] },
    { label: 'shortcuts.findInFile', keys: [shortcutLabel('F')] },
    {
        label: 'common.findInFiles',
        keys: [shortcutLabel('F')],
        also: 'shortcuts.findInFilesAlso',
    },
    { label: 'shortcuts.matches', keys: ['↵', '⇧↵'] },
    { label: 'shortcuts.tree', keys: ['←', '→', '↑', '↓', '↵'] },
    { label: 'shortcuts.newNote', keys: [shortcutLabel('N')] },
    { label: 'shortcuts.wrapNote', keys: [altLabel('Z')] },
    { label: 'shortcuts.closeNote', keys: ['Esc', shortcutLabel('↵')] },
    { label: 'shortcuts.reorderNotes', keys: [altLabel('↑'), altLabel('↓')] },
    { label: 'shortcuts.settings', keys: [shortcutLabel(',')] },
    { label: 'shortcuts.help', keys: ['?'] },
];

/**
 * The app's shortcuts, in a card over the bottom right corner that leaves the page usable: the
 * top bar's `?` or the `?` key shows and hides it, `Esc` hides it before anything else.
 */
export function ShortcutsHelp({ onClose }: { onClose: () => void }) {
    useWindowKeys(
        (event) => {
            if (event.key !== 'Escape' || event.defaultPrevented || isKeyTaken(event.target)) {
                return;
            }
            event.preventDefault();
            onClose();
        },
        { capture: true },
    );
    const { t } = useTranslation();
    const rows = SHORTCUTS.map((shortcut) =>
        shortcut === 'panels'
            ? {
                  label: PALETTE_PANELS.map((panel) => t(panel.title)).join(', '),
                  keys: PALETTE_PANELS.map((panel) => panel.shortcut),
                  also: undefined,
              }
            : {
                  label: t(shortcut.label),
                  keys: shortcut.keys,
                  also: shortcut.also ? t(shortcut.also) : undefined,
              },
    );

    return (
        <aside
            aria-label={t('common.shortcuts')}
            className="fixed right-4 bottom-4 z-10 w-[320px] rounded-xl border border-ui-border-hover bg-ui-surface px-3.5 pt-2.5 pb-3 text-[12.5px] shadow-[0_12px_32px_var(--ui-shadow-soft)]"
        >
            <div className="mb-1.5 flex items-center justify-between">
                <h2 className="text-[11px] font-semibold tracking-[.04em] text-ui-text-muted uppercase">
                    {t('common.shortcuts')}
                </h2>
                <button
                    type="button"
                    className="btn-icon h-6 w-6"
                    title={`${t('common.close')} (Esc)`}
                    aria-label={t('common.close')}
                    onClick={onClose}
                >
                    <IconX size={14} />
                </button>
            </div>
            <dl>
                {rows.map((shortcut) => (
                    <div
                        key={shortcut.label}
                        className="flex items-baseline justify-between gap-3 py-[3px]"
                    >
                        <dt className="min-w-0 text-ui-text-secondary">{shortcut.label}</dt>
                        <dd className="flex shrink-0 items-baseline gap-1 text-ui-text-muted">
                            {shortcut.keys.map((key) => (
                                <kbd key={key} className="kbd">
                                    {key}
                                </kbd>
                            ))}
                            {shortcut.also ? (
                                <span className="ml-1 text-[11.5px]">{shortcut.also}</span>
                            ) : null}
                        </dd>
                    </div>
                ))}
            </dl>
        </aside>
    );
}
