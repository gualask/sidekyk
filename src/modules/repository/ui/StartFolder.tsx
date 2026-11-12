import { IconPlayerPlay } from '@tabler/icons-react';
import { useTranslation } from '@/shared/i18n';
import type { PanelProps } from '@/shared/panels/panel';
import type { ProjectFolder } from '@/shared/projects/project-info';
import { remoteMachine } from '@/shared/projects/project-place';
import { useStartFolder } from '../application/queries/folder-kind';
import { projectErrorMessage } from '../model/project-error';

/**
 * In place of a project's folder panels while the WSL distro that holds it is stopped: it starts
 * only from here, so a note read or a project passed through starts nothing. Once started, the
 * folder's panels take its place.
 */
export function StartFolder({ folder }: PanelProps) {
    const distro = folder ? remoteMachine(folder) : null;
    return folder && distro ? <Start folder={folder} distro={distro} /> : null;
}

function Start({ folder, distro }: { folder: ProjectFolder; distro: string }) {
    const i18n = useTranslation();
    const { t } = i18n;
    const start = useStartFolder(folder.id);
    return (
        <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
            {start.isPending ? (
                <p className="text-sm text-ui-text-muted">{t('projects.starting', { distro })}</p>
            ) : (
                <>
                    <p className="text-sm text-ui-text-secondary">
                        {t('changes.distroStopped', { distro })}
                    </p>
                    {start.isError ? (
                        <p className="max-w-[420px] text-xs text-ui-danger">
                            {projectErrorMessage(start.error, folder, i18n)}
                        </p>
                    ) : null}
                    <button type="button" className="btn-primary-sm" onClick={() => start.mutate()}>
                        <IconPlayerPlay size={14} stroke={2} />
                        {t('projects.startDistro', { distro })}
                    </button>
                </>
            )}
        </div>
    );
}
