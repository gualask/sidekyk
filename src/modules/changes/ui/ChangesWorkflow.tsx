import type { PanelProps } from '@/shared/panels/panel';
import { ChangesWorkspace } from './ChangesWorkspace';

/** The Changes panel: what changed in the project's working tree. */
export function ChangesWorkflow({ project }: PanelProps) {
    return <ChangesWorkspace key={project.root} repository={project} />;
}
