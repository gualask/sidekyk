import { IconX } from '@tabler/icons-react';
import { type MessageKey, useTranslation } from '@/shared/i18n';
import { MACOS } from '@/shared/platform/macos';
import { altLabel, shortcutLabel } from '@/shared/platform/shortcut';
import { useWindowKeys } from '@/shared/ui/hooks/use-window-keys';
import { isKeyTaken } from '@/shared/ui/keys';
import { PANEL_KEYS } from './panels';

/** A shortcut: what it does, and its keys, each its own key cap. */
interface Shortcut {
    label: MessageKey;
    keys: string[];
    /** Words under what it does, such as another way to do it. */
    also?: MessageKey;
}

/** A group of shortcuts under its title; `panels`: the keys that open each panel. */
interface Section {
    title: MessageKey;
    shortcuts: (Shortcut | 'panels')[];
}

/** In the card's order: moving around first, then finding, then each panel's own keys. */
const SECTIONS: Section[] = [
    {
        title: 'shortcuts.section.navigate',
        shortcuts: [
            {
                label: 'shortcuts.zoom',
                keys: ['↵', 'Esc'],
                also: MACOS ? 'shortcuts.zoomAlsoMac' : 'shortcuts.zoomAlso',
            },
            { label: 'shortcuts.tiles', keys: ['←', '→'] },
            { label: 'shortcuts.list', keys: ['j', 'k'], also: 'shortcuts.listAlso' },
            'panels',
            { label: 'shortcuts.projects', keys: ['[', ']'] },
        ],
    },
    {
        title: 'shortcuts.section.find',
        shortcuts: [
            { label: 'shortcuts.goTo', keys: [shortcutLabel('K')] },
            { label: 'shortcuts.findInFile', keys: [shortcutLabel('F')] },
            {
                label: 'common.findInFiles',
                keys: [shortcutLabel('F')],
                also: 'shortcuts.findInFilesAlso',
            },
            { label: 'shortcuts.matches', keys: ['↵', '⇧↵'], also: 'shortcuts.matchesAlso' },
        ],
    },
    {
        title: 'shortcuts.section.changes',
        shortcuts: [
            { label: 'shortcuts.changes', keys: ['n', 'p'] },
            { label: 'shortcuts.tree', keys: ['←', '→', '↑', '↓', '↵'] },
        ],
    },
    {
        title: 'panel.notes',
        shortcuts: [
            { label: 'shortcuts.newNote', keys: [shortcutLabel('N')] },
            { label: 'shortcuts.wrapNote', keys: [altLabel('Z')] },
            { label: 'shortcuts.closeNote', keys: ['Esc', shortcutLabel('↵')] },
            { label: 'shortcuts.reorderNotes', keys: [altLabel('↑'), altLabel('↓')] },
        ],
    },
    {
        title: 'shortcuts.section.app',
        shortcuts: [
            { label: 'shortcuts.settings', keys: [shortcutLabel(',')] },
            { label: 'shortcuts.help', keys: ['?'] },
        ],
    },
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
    const rowOf = (shortcut: Shortcut | 'panels') =>
        shortcut === 'panels'
            ? {
                  label: PANEL_KEYS.map((panel) => t(panel.title)).join(', '),
                  keys: PANEL_KEYS.map((panel) => panel.shortcut),
                  also: undefined,
              }
            : {
                  label: t(shortcut.label),
                  keys: shortcut.keys,
                  also: shortcut.also ? t(shortcut.also) : undefined,
              };

    return (
        <aside
            aria-label={t('common.shortcuts')}
            className="fixed right-4 bottom-4 z-10 max-h-[calc(100vh-72px)] w-[min(760px,calc(100vw-32px))] overflow-auto rounded-xl border border-ui-border-hover bg-ui-surface px-4 pt-3 pb-3.5 text-[13.5px] shadow-[0_12px_32px_var(--ui-shadow-soft)]"
        >
            <div className="mb-1 flex items-center justify-between">
                <h2 className="text-[15px] font-bold">{t('common.shortcuts')}</h2>
                <button
                    type="button"
                    className="btn-icon h-7 w-7"
                    title={`${t('common.close')} (Esc)`}
                    aria-label={t('common.close')}
                    onClick={onClose}
                >
                    <IconX size={16} />
                </button>
            </div>
            {/* two columns of sections, each kept whole */}
            <div className="columns-[320px] gap-x-8">
                {SECTIONS.map((section) => (
                    <section key={section.title} className="break-inside-avoid pt-2.5">
                        <h3 className="mb-1 flex items-center gap-2.5 text-[11px] font-semibold tracking-[.04em] text-ui-text-muted uppercase">
                            {t(section.title)}
                            <span aria-hidden className="h-px flex-1 bg-ui-border" />
                        </h3>
                        <dl>
                            {section.shortcuts.map(rowOf).map((shortcut) => (
                                <div
                                    key={shortcut.label}
                                    className="flex items-baseline justify-between gap-3 py-1"
                                >
                                    <dt className="min-w-0 text-ui-text-secondary">
                                        {shortcut.label}
                                        {shortcut.also ? (
                                            <div className="text-xs text-ui-text-muted">
                                                {shortcut.also}
                                            </div>
                                        ) : null}
                                    </dt>
                                    <dd className="flex shrink-0 items-baseline gap-1">
                                        {shortcut.keys.map((key) => (
                                            <kbd key={key} className="kbd">
                                                {key}
                                            </kbd>
                                        ))}
                                    </dd>
                                </div>
                            ))}
                        </dl>
                    </section>
                ))}
            </div>
        </aside>
    );
}
