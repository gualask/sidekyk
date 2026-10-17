import { IconX } from '@tabler/icons-react';
import { MACOS } from '@/shared/platform/macos';
import { shortcutLabel } from '@/shared/platform/shortcut';
import { useWindowKeys } from '@/shared/ui/hooks/use-window-keys';
import { isKeyTaken } from '@/shared/ui/keys';
import { PALETTE_PANELS } from './panels';

/** A shortcut: what it does, and its keys, each its own key cap. */
interface Shortcut {
    label: string;
    keys: string[];
    /** Words after the keys, such as another way to do it. */
    also?: string;
}

const SHORTCUTS: Shortcut[] = [
    { label: 'Zoom in / out', keys: ['↵', 'Esc'], also: MACOS ? '⌘+scroll, pinch' : 'Ctrl+scroll' },
    { label: 'Move among tiles', keys: ['←', '→'] },
    { label: 'Move in a list', keys: ['j', 'k'], also: 'arrows full screen' },
    {
        label: PALETTE_PANELS.map((panel) => panel.title).join(', '),
        keys: PALETTE_PANELS.map((panel) => panel.shortcut),
    },
    { label: 'Previous / next project', keys: ['[', ']'] },
    { label: 'Go to project, panel or file', keys: [shortcutLabel('K')] },
    { label: 'Find in the file open', keys: [shortcutLabel('F')] },
    { label: 'Find in files', keys: [shortcutLabel('F')], also: 'again, from the find bar' },
    { label: 'Next / previous match, find bar', keys: ['↵', '⇧↵'] },
    { label: 'Files tree, full screen', keys: ['←', '→', '↑', '↓', '↵'] },
    { label: 'New note', keys: [shortcutLabel('N')] },
    { label: 'Close the note you edit', keys: ['Esc', shortcutLabel('↵')] },
    {
        label: "Reorder notes (from a note's ⋯)",
        keys: MACOS ? ['⌥↑', '⌥↓'] : ['Alt+↑', 'Alt+↓'],
    },
    { label: 'Settings', keys: [shortcutLabel(',')] },
    { label: 'Show or hide this', keys: ['?'] },
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

    return (
        <aside
            aria-label="Shortcuts"
            className="fixed right-4 bottom-4 z-10 w-[320px] rounded-xl border border-ui-border-hover bg-ui-surface px-3.5 pt-2.5 pb-3 text-[12.5px] shadow-[0_12px_32px_var(--ui-shadow-soft)]"
        >
            <div className="mb-1.5 flex items-center justify-between">
                <h2 className="text-[11px] font-semibold tracking-[.04em] text-ui-text-muted uppercase">
                    Shortcuts
                </h2>
                <button
                    type="button"
                    className="btn-icon h-6 w-6"
                    title="Close (Esc)"
                    aria-label="Close"
                    onClick={onClose}
                >
                    <IconX size={14} />
                </button>
            </div>
            <dl>
                {SHORTCUTS.map((shortcut) => (
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
