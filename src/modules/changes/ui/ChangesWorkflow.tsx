import type { PanelProps } from '@/shared/panels/panel';
import { ChangesWorkspace } from './ChangesWorkspace';

/** The Changes panel: what changed in the project's working tree. */
export function ChangesWorkflow({ project, header }: PanelProps) {
    return <ChangesWorkspace key={project.root} repository={project} header={header} />;
}
