import { changesPanel } from '@/modules/changes';
import type { PanelDefinition } from '@/shared/panels/panel';

/** Every panel, in the order of their shortcuts (`1`, `2`, …). */
const PANELS: readonly PanelDefinition[] = [changesPanel];

/** The panel shown at startup. Its chunk starts loading with the app, not after the first render. */
export const INITIAL_PANEL = PANELS[0];
void INITIAL_PANEL.preload();
