import { IconX } from '@tabler/icons-react';
import { type Ref, useId } from 'react';
import { useTranslation } from '@/shared/i18n';
import { FolderPath } from '@/shared/projects/FolderPath';
import type { ProjectLocation } from '@/shared/projects/project-info';
import { folderName, placeName } from '@/shared/projects/project-place';

/** A project's name, as its dialogs ask for it. */
export function NameField({
    value,
    onChange,
    inputRef,
    disabled = false,
}: {
    value: string;
    onChange: (name: string) => void;
    inputRef?: Ref<HTMLInputElement>;
    disabled?: boolean;
}) {
    const { t } = useTranslation();
    const id = useId();
    return (
        <div className="flex flex-col gap-1">
            <label htmlFor={id} className="text-xs font-semibold">
                {t('projects.name')}
            </label>
            <input
                id={id}
                ref={inputRef}
                value={value}
                disabled={disabled}
                spellCheck={false}
                autoComplete="off"
                className="rounded-lg border border-ui-border bg-ui-surface-subtle px-2.5 py-1.5 text-[13px] outline-none focus:border-ui-accent disabled:text-ui-text-muted"
                onChange={(event) => onChange(event.target.value)}
            />
        </div>
    );
}

/**
 * A folder of a project in its dialog: its name, where it is muted after it (cut at its start, as
 * everywhere, whole in the tooltip), and × to leave it out, unless `onRemove` is null.
 */
export function FolderRow({
    location,
    onRemove,
    disabled = false,
}: {
    location: ProjectLocation;
    onRemove: (() => void) | null;
    disabled?: boolean;
}) {
    const { t } = useTranslation();
    const name = folderName(location);
    return (
        <li className="flex min-w-0 items-center gap-2 text-[13px]">
            <span className="shrink-0 font-medium">{name}</span>
            <span className="flex min-w-0 flex-1">
                <FolderPath path={placeName(location)} />
            </span>
            {onRemove ? (
                <button
                    type="button"
                    className="btn-icon h-6 w-6 shrink-0"
                    disabled={disabled}
                    title={t('projects.removeFolder', { name })}
                    aria-label={t('projects.removeFolder', { name })}
                    onClick={onRemove}
                >
                    <IconX size={13} />
                </button>
            ) : null}
        </li>
    );
}
