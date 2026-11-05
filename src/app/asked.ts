import type { PanelTarget } from '@/shared/panels/panel';

/**
 * What a panel was asked to show, until it takes it (`docs/architecture.md`, Frontend): a change
 * to what it shows, delivered once, never kept as what it shows. For one panel of one project,
 * and of one folder of it (null: whichever shows, as for notes).
 */
export interface Asked {
    project: string;
    folder: string | null;
    panel: string;
    target: PanelTarget;
}

/** Where a panel is: its project and the folder on screen. */
interface PanelPlace {
    project: string | null;
    folder: string | null;
    panel: string;
}

/**
 * The target a panel gets: what is asked of it, while its project and folder show; nothing for
 * any other panel. A request for a project not on screen yet waits for it.
 */
export function targetFor(asked: Asked | null, place: PanelPlace): PanelTarget | null {
    if (!asked || asked.panel !== place.panel || asked.project !== place.project) return null;
    if (asked.folder !== null && asked.folder !== place.folder) return null;
    return asked.target;
}

/** What is asked once a panel took `target`: nothing, unless a newer request replaced it. */
export function taken(asked: Asked | null, target: PanelTarget): Asked | null {
    return asked?.target === target ? null : asked;
}
