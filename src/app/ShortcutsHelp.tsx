import { IconX } from '@tabler/icons-react';
import { type MessageKey, useTranslation } from '@/shared/i18n';
import { withKeys } from '@/shared/platform/keys';
import { MACOS } from '@/shared/platform/macos';
import { useWindowKeys } from '@/shared/ui/hooks/use-window-keys';
import { KeyCap } from '@/shared/ui/KeyCaps';
import { isKeyTaken } from '@/shared/ui/keys';
import { PANEL_KEYS } from './panels';

/** A shortcut: what it does, and its combinations (`shared/platform/keys.ts`), each a key cap. */
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
                keys: ['Enter', 'Escape'],
                also: MACOS ? 'shortcuts.zoomAlsoMac' : 'shortcuts.zoomAlso',
            },
            { label: 'shortcuts.tiles', keys: ['ArrowLeft', 'ArrowRight'] },
            { label: 'shortcuts.list', keys: ['j', 'k'], also: 'shortcuts.listAlso' },
            'panels',
            { label: 'shortcuts.projects', keys: ['[', ']'] },
        ],
    },
    {
        title: 'shortcuts.section.find',
        shortcuts: [
            { label: 'shortcuts.goTo', keys: ['Mod+K'] },
            { label: 'shortcuts.findInFile', keys: ['Mod+F'] },
            {
                label: 'common.findInFiles',
                keys: ['Mod+F'],
                also: 'shortcuts.findInFilesAlso',
            },
            {
                label: 'shortcuts.matches',
                keys: ['Enter', 'Shift+Enter'],
                also: 'shortcuts.matchesAlso',
            },
        ],
    },
    {
        title: 'shortcuts.section.changes',
        shortcuts: [
            { label: 'shortcuts.changes', keys: ['n', 'p'] },
            {
                label: 'shortcuts.tree',
                keys: ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter'],
            },
        ],
    },
    {
        title: 'panel.notes',
        shortcuts: [
            { label: 'shortcuts.newNote', keys: ['Mod+KeyN'] },
            { label: 'shortcuts.wrapNote', keys: ['Alt+KeyZ'] },
            { label: 'shortcuts.openReference', keys: ['Alt+Enter'] },
            { label: 'shortcuts.closeNote', keys: ['Escape', 'Mod+Enter'] },
            { label: 'shortcuts.reorderNotes', keys: ['Alt+ArrowUp', 'Alt+ArrowDown'] },
        ],
    },
    {
        title: 'shortcuts.section.app',
        shortcuts: [
            { label: 'shortcuts.settings', keys: ['Mod+,'] },
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
                    title={withKeys(t('common.close'), 'Escape')}
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
                                        {shortcut.keys.map((keys) => (
                                            <KeyCap key={keys} keys={keys} />
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
