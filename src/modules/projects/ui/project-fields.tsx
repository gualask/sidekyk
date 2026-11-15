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
function FolderRow({
    location,
    onRemove,
    disabled = false,
}: {
    location: ProjectLocation;
    onRemove: (() => void) | null;
    disabled?: boolean;
}) {
    const i18n = useTranslation();
    const { t } = i18n;
    const name = folderName(location);
    return (
        <li className="flex min-w-0 items-center gap-2 text-[13px]">
            <span className="shrink-0 font-medium">{name}</span>
            <span className="flex min-w-0 flex-1">
                <FolderPath path={placeName(location, i18n)} />
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

/**
 * A project's folders in its dialog, by `key`: a `FolderRow` each, × leaving one out unless
 * `onRemove` is null; without folders, a line that says so, where folders can be left out.
 */
export function FolderList({
    folders,
    onRemove,
    disabled = false,
}: {
    folders: readonly { key: string; location: ProjectLocation }[];
    onRemove: ((key: string) => void) | null;
    disabled?: boolean;
}) {
    const { t } = useTranslation();
    if (folders.length === 0) {
        return onRemove ? (
            <p className="text-[13px] text-ui-text-muted">{t('projects.noFolder')}</p>
        ) : null;
    }
    return (
        <ul className="flex flex-col gap-1">
            {folders.map(({ key, location }) => (
                <FolderRow
                    key={key}
                    location={location}
                    disabled={disabled}
                    onRemove={onRemove ? () => onRemove(key) : null}
                />
            ))}
        </ul>
    );
}
