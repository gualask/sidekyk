import { useEffect, useEffectEvent, useState } from 'react';
import type { PanelTarget } from '@/shared/panels/panel';
import type { ProjectInfo } from '@/shared/projects/project-info';

/** What a panel was asked to show, and which panel of which project: no other project's shows it. */
export interface Asked {
    project: string;
    panel: string;
    target: PanelTarget;
}

export function askedOf(project: ProjectInfo, panel: string, target: PanelTarget): Asked {
    return { project: project.id, panel, target };
}

/**
 * What a panel of a project not on screen yet was asked to show (a note found at all projects):
 * kept until `shown`, the project whose panels show, is that one, then handed to `give` once.
 * Asking again replaces it; null lets it go.
 */
export function useWaitingAsked(
    shown: string | null,
    give: (asked: Asked) => void,
): (asked: Asked | null) => void {
    const [waiting, setWaiting] = useState<Asked | null>(null);
    const ready = waiting?.project === shown ? waiting : null;
    const giving = useEffectEvent((asked: Asked) => {
        setWaiting(null);
        give(asked);
    });
    useEffect(() => {
        if (ready) giving(ready);
    }, [ready]);
    return setWaiting;
}
