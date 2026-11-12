import { Radio } from '@base-ui/react/radio';
import { RadioGroup } from '@base-ui/react/radio-group';
import { useTranslation } from '@/shared/i18n';
import type { ParentFolder, ParentUse } from '../model/new-project';
import type { FolderChoice } from '../model/project.types';

/** What the folder picked was, said under the folders, when it was not taken. */
export type FolderNotice = Extract<FolderChoice, { kind: 'inProject' }>;

/** A parent of repositories picked first, and what it becomes. */
export interface PickedParent {
    folder: ParentFolder;
    use: ParentUse;
}

/**
 * A parent of repositories picked: which repositories are inside (those of another project said
 * so, and left out), and what it becomes.
 */
export function ParentChoice({
    parent,
    onUse,
}: {
    parent: PickedParent;
    onUse: (use: ParentUse) => void;
}) {
    const { t, tp } = useTranslation();
    const { folder } = parent;
    const names = folder.repositories.map((repository) =>
        repository.inProject === null
            ? repository.name
            : t('projects.repositoryInProject', {
                  name: repository.name,
                  project: repository.inProject,
              }),
    );
    const options: { use: ParentUse; label: string }[] = [
        { use: 'together', label: t('projects.parentTogether') },
        { use: 'each', label: t('projects.parentEach') },
        { use: 'folder', label: t('projects.parentFolder') },
    ];
    return (
        <div className="flex flex-col gap-2 rounded-lg bg-ui-surface-subtle p-2.5">
            <p className="text-[13px]">
                {tp('projects.parentHolds', folder.repositories.length, { name: folder.name })}{' '}
                <span className="text-ui-text-muted">{names.join(', ')}</span>
            </p>
            <RadioGroup
                aria-label={t('projects.parentUse')}
                className="seg self-start"
                value={parent.use}
                onValueChange={(value) => onUse(value as ParentUse)}
            >
                {options.map((option) => (
                    <Radio.Root key={option.use} value={option.use} className="seg-item">
                        {option.label}
                    </Radio.Root>
                ))}
            </RadioGroup>
        </div>
    );
}

/** Why the folder picked was not taken, or why picking failed: under the folders. */
export function FolderMessage({
    notice,
    error,
    onOpen,
}: {
    notice: FolderNotice | null;
    error: string | null;
    onOpen: (projectId: string) => void;
}) {
    const { t } = useTranslation();
    if (error) {
        return (
            <p role="alert" className="text-xs text-ui-danger">
                {error}
            </p>
        );
    }
    if (!notice) return null;
    return (
        <p role="alert" className="flex items-center gap-2 text-xs text-ui-warning-soft-text">
            {t('projects.alreadyProject', { name: notice.name })}
            <button
                type="button"
                className="btn-ghost-sm min-h-6 py-0.5"
                onClick={() => onOpen(notice.id)}
            >
                {t('common.open')}
            </button>
        </p>
    );
}
