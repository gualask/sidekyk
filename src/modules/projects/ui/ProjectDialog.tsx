import { Dialog } from '@base-ui/react/dialog';
import { type FormEvent, useId, useRef, useState } from 'react';
import { errorMessage } from '@/shared/errors/app-error';
import { useTranslation } from '@/shared/i18n';
import type { ProjectInfo } from '@/shared/projects/project-info';
import { placeName } from '@/shared/projects/project-place';
import {
    useChooseProjectFolder,
    useCreateProject,
    useRenameProject,
} from '../application/projects.queries';
import type { FolderChoice } from '../model/project.types';

/** A folder taken for the new project: the path to give back, where it is to show. */
type ChosenFolder = Extract<FolderChoice, { kind: 'usable' }>;

/** What the folder picked was, said under the field, when it was not taken. */
type FolderNotice = Exclude<FolderChoice, ChosenFolder>;

/**
 * New project, the same for everyone: a name, and a folder if wanted (any folder, inside a
 * repository the repository's: its name fills an empty name). A folder that is another project's
 * is said under the field and not taken. `↵` creates. Renaming a project is the same dialog, with
 * its name only. Loaded with its first opening.
 */
export function ProjectDialog({
    renaming,
    onCreated,
    onOpenProject,
    onClose,
}: {
    /** The project to rename; null makes a new one. */
    renaming: ProjectInfo | null;
    /** The new project is on screen: show it. */
    onCreated: () => void;
    /** Shows the project the folder picked already is. */
    onOpenProject: (projectId: string) => void;
    onClose: () => void;
}) {
    const [name, setName] = useState(renaming?.name ?? '');
    const [folder, setFolder] = useState<ChosenFolder | null>(null);
    const [notice, setNotice] = useState<FolderNotice | null>(null);
    const choose = useChooseProjectFolder();
    const create = useCreateProject(() => {
        onClose();
        onCreated();
    });
    const rename = useRenameProject(onClose);
    const change = renaming ? rename : create;
    const nameField = useRef<HTMLInputElement>(null);
    const nameId = useId();
    const i18n = useTranslation();
    const { t } = i18n;

    const chooseFolder = async () => {
        const choice = await choose.mutateAsync().catch(() => null);
        if (!choice) return;
        if (choice.kind !== 'usable') {
            setNotice(choice);
            return;
        }
        setNotice(null);
        setFolder(choice);
        if (name.trim() === '') setName(choice.name);
    };
    const blank = name.trim() === '';
    const submit = (event: FormEvent) => {
        event.preventDefault();
        if (blank || change.isPending) return;
        if (renaming) rename.mutate({ projectId: renaming.id, name });
        else create.mutate({ name, folder: folder?.path ?? null });
    };

    return (
        <Dialog.Root
            open
            onOpenChange={(open) => {
                if (!open) onClose();
            }}
        >
            <Dialog.Portal>
                <Dialog.Backdrop className="dialog-backdrop" />
                <Dialog.Popup
                    initialFocus={nameField}
                    className="dialog-popup top-[18vh] w-[min(460px,calc(100vw-32px))] p-4"
                >
                    <Dialog.Title className="text-[15px] font-bold">
                        {t(renaming ? 'projects.rename' : 'projects.new')}
                    </Dialog.Title>
                    <form className="mt-3 flex flex-col gap-3" onSubmit={submit}>
                        <div className="flex flex-col gap-1">
                            <label htmlFor={nameId} className="text-xs font-semibold">
                                {t('projects.name')}
                            </label>
                            <input
                                id={nameId}
                                ref={nameField}
                                value={name}
                                spellCheck={false}
                                autoComplete="off"
                                className="rounded-lg border border-ui-border bg-ui-surface-subtle px-2.5 py-1.5 text-[13px] outline-none focus:border-ui-accent"
                                onChange={(event) => setName(event.target.value)}
                            />
                        </div>
                        {renaming ? null : (
                            <fieldset className="flex min-w-0 flex-col gap-1">
                                <legend className="mb-1 text-xs font-semibold">
                                    {t('projects.folder')}
                                </legend>
                                <div className="flex items-center gap-2">
                                    <span
                                        className={`min-w-0 flex-1 truncate text-[13px] ${
                                            folder ? '' : 'text-ui-text-muted'
                                        }`}
                                        title={folder ? placeName(folder.location) : undefined}
                                    >
                                        {folder
                                            ? placeName(folder.location)
                                            : t('projects.noFolder')}
                                    </span>
                                    {folder ? (
                                        <button
                                            type="button"
                                            className="btn-ghost-sm"
                                            onClick={() => setFolder(null)}
                                        >
                                            {t('projects.noFolder')}
                                        </button>
                                    ) : null}
                                    <button
                                        type="button"
                                        className="btn-ghost-sm"
                                        disabled={choose.isPending}
                                        onClick={() => void chooseFolder()}
                                    >
                                        {t('projects.choose')}
                                    </button>
                                </div>
                                <FolderMessage
                                    notice={notice}
                                    error={choose.isError ? errorMessage(choose.error, i18n) : null}
                                    onOpen={(id) => {
                                        onClose();
                                        onOpenProject(id);
                                    }}
                                />
                            </fieldset>
                        )}
                        {change.isError ? (
                            <p role="alert" className="text-xs text-ui-danger">
                                {errorMessage(change.error, i18n)}
                            </p>
                        ) : null}
                        <div className="mt-1 flex justify-end gap-2">
                            <Dialog.Close className="btn-ghost-sm">
                                {t('common.cancel')}
                            </Dialog.Close>
                            <button
                                type="submit"
                                className="btn-primary-sm"
                                disabled={blank || change.isPending}
                            >
                                {t(renaming ? 'projects.rename' : 'projects.create')}
                            </button>
                        </div>
                    </form>
                </Dialog.Popup>
            </Dialog.Portal>
        </Dialog.Root>
    );
}

/** Why the folder picked was not taken, or why picking failed: under the field. */
function FolderMessage({
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
