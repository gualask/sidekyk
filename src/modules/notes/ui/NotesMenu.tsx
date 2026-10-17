import { Menu } from '@base-ui/react/menu';
import { IconDots, IconFileExport } from '@tabler/icons-react';

/** The Notes panel's own actions, in its header: what concerns all of a project's notes. */
export function NotesMenu({ onExport }: { onExport: () => void }) {
    return (
        <Menu.Root>
            <Menu.Trigger
                className="btn-icon h-[26px] w-[26px] data-popup-open:bg-ui-surface-hover data-popup-open:text-ui-text"
                title="More"
                aria-label="More for the notes"
            >
                <IconDots size={14} />
            </Menu.Trigger>
            <Menu.Portal>
                <Menu.Positioner sideOffset={4} align="end">
                    <Menu.Popup className="menu-popup">
                        <Menu.Item className="menu-item" onClick={onExport}>
                            <IconFileExport size={14} />
                            Export notes…
                        </Menu.Item>
                    </Menu.Popup>
                </Menu.Positioner>
            </Menu.Portal>
        </Menu.Root>
    );
}
