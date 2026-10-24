import { IconPlayerPlay } from '@tabler/icons-react';
import { useTranslation } from '@/shared/i18n';
import type { PanelProps } from '@/shared/panels/panel';
import { projectFolder } from '@/shared/projects/project-info';
import { useStartFolder } from '../application/repository.queries';
import { projectErrorMessage } from '../model/project-error';

/**
 * In place of a project's folder panels while the WSL distro that holds it is stopped: it starts
 * only from here, so a note read or a project passed through starts nothing. Once started, the
 * folder's panels take its place.
 */
export function StartFolder({ project }: PanelProps) {
    const i18n = useTranslation();
    const { t } = i18n;
    const start = useStartFolder(project.id);
    const folder = projectFolder(project);
    if (folder?.kind !== 'wsl') return null;
    const { distro } = folder;
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
