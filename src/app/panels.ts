import { changesPanel } from '@/modules/changes';
import type { PanelDefinition } from '@/shared/panels/panel';

/** Every panel, in the order of their shortcuts (`1`, `2`, …). */
const PANELS: readonly PanelDefinition[] = [changesPanel];

/** The panel shown at startup. Its chunk starts loading with the app, not after the first render. */
export const INITIAL_PANEL = PANELS[0];
void INITIAL_PANEL.preload();

/** The panels that say something about a project on its card at all projects. */
export const SUMMARIES = PANELS.flatMap((panel) =>
    panel.summary ? [{ id: panel.id, ...panel.summary }] : [],
);

/** The panel a key opens full screen (`1`, `2`, …), if any. */
export function panelForKey(key: string): PanelDefinition | undefined {
    return /^[1-9]$/.test(key) ? PANELS[Number(key) - 1] : undefined;
}

/** The key that opens a panel, named in its tooltips. */
export function panelShortcut(panel: PanelDefinition): string {
    return String(PANELS.indexOf(panel) + 1);
}
