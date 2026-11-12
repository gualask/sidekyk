import { Dialog } from '@base-ui/react/dialog';
import { type FormEvent, useRef, useState } from 'react';
import { errorMessage } from '@/shared/errors/app-error';
import { useTranslation } from '@/shared/i18n';
import type { ProjectInfo } from '@/shared/projects/project-info';
import { useAddProjectFolder, useRemoveProjectFolder } from '../application/project-folders';
import { useEditProject, useMergeProjects, useProjects } from '../application/projects.queries';
import { writtenLetters } from '../model/avatar-letters';
import { AvatarField } from './avatar-field';
import { FolderRow, NameField } from './project-fields';

/** Another project that has the folder picked: merged into this one if the user says so. */
interface Mergeable {
    id: string;
    name: string;
}

/**
 * A project's name, avatar and folders. A folder added or left out changes the project at once, as
 * VS Code's "Add Folder to Workspace" (the folder is left as it is, the notes stay); the name and
 * the avatar are kept with Save. A folder that is another project's offers to merge that project into this one: its
 * folders and lists of notes come here, and it goes. Loaded with its first opening.
 */
export function EditProjectDialog({
    project: opened,
    onMerged,
    onClose,
}: {
    project: ProjectInfo;
    /** A project was merged into this one: what kept their notes reads them again. */
    onMerged: (into: string, from: string) => void;
    onClose: () => void;
}) {
    // the project as the list has it now, its folders changing while the dialog is open
    const project = useProjects().data?.projects.find((p) => p.id === opened.id) ?? opened;
    const [name, setName] = useState(project.name);
    const [letters, setLetters] = useState(project.avatar.letters ?? '');
    const [color, setColor] = useState(project.avatar.color);
    const [mergeable, setMergeable] = useState<Mergeable | null>(null);
    const save = useEditProject();
    const add = useAddProjectFolder();
    const remove = useRemoveProjectFolder();
    const merge = useMergeProjects(onMerged);
    const nameField = useRef<HTMLInputElement>(null);
    const i18n = useTranslation();
    const { t } = i18n;

    const addFolder = async () => {
        setMergeable(null);
        const change = await add.mutateAsync(project.id).catch(() => null);
        if (change?.kind === 'inProject') setMergeable({ id: change.id, name: change.name });
    };
    const blank = name.trim() === '';
    const written = writtenLetters(letters);
    const cannotSave = blank || written === false || save.isPending;
    const submit = (event: FormEvent) => {
        event.preventDefault();
        if (cannotSave) return;
        const avatar = { color, letters: written };
        const same =
            name === project.name &&
            color === project.avatar.color &&
            written === project.avatar.letters;
        if (same) onClose();
        else save.mutate({ projectId: project.id, name, avatar }, { onSuccess: onClose });
    };
    const error = [save, add, remove, merge].find((change) => change.isError)?.error;

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
                    className="dialog-popup top-[18vh] w-[min(460px,calc(100vw-32px))] overflow-auto p-4"
                >
                    <Dialog.Title className="text-[15px] font-bold">
                        {t('projects.edit')}
                    </Dialog.Title>
                    <form className="mt-3 flex flex-col gap-3" onSubmit={submit}>
                        <NameField value={name} onChange={setName} inputRef={nameField} />
                        <AvatarField
                            name={name}
                            letters={letters}
                            color={color}
                            invalid={written === false}
                            onLetters={setLetters}
                            onColor={setColor}
                        />
                        <fieldset className="flex min-w-0 flex-col gap-1.5">
                            <legend className="mb-1 text-xs font-semibold">
                                {t('projects.folders')}
                            </legend>
                            <ProjectFolders
                                project={project}
                                removing={remove.isPending}
                                onRemove={(folderId) =>
                                    remove.mutate({ projectId: project.id, folderId })
                                }
                            />
                            <div>
                                <button
                                    type="button"
                                    className="btn-ghost-sm"
                                    disabled={add.isPending || merge.isPending}
                                    onClick={() => void addFolder()}
                                >
                                    {t('projects.addFolder')}
                                </button>
                            </div>
                            {mergeable ? (
                                <MergeAsk
                                    from={mergeable.name}
                                    into={project.name}
                                    merging={merge.isPending}
                                    onKeepApart={() => setMergeable(null)}
                                    onMerge={() =>
                                        merge.mutate(
                                            { into: project.id, from: mergeable.id },
                                            { onSuccess: () => setMergeable(null) },
                                        )
                                    }
                                />
                            ) : null}
                        </fieldset>
                        {error ? (
                            <p role="alert" className="text-xs text-ui-danger">
                                {errorMessage(error, i18n)}
                            </p>
                        ) : null}
                        <div className="mt-1 flex justify-end gap-2">
                            <Dialog.Close className="btn-ghost-sm">
                                {t('common.cancel')}
                            </Dialog.Close>
                            <button type="submit" className="btn-primary-sm" disabled={cannotSave}>
                                {t('projects.save')}
                            </button>
                        </div>
                    </form>
                </Dialog.Popup>
            </Dialog.Portal>
        </Dialog.Root>
    );
}

/** The project's folders, each with × to leave it out, or a line saying it has none. */
function ProjectFolders({
    project,
    removing,
    onRemove,
}: {
    project: ProjectInfo;
    removing: boolean;
    onRemove: (folderId: string) => void;
}) {
    const { t } = useTranslation();
    if (project.folders.length === 0) {
        return <p className="text-[13px] text-ui-text-muted">{t('projects.noFolder')}</p>;
    }
    return (
        <ul className="flex flex-col gap-1">
            {project.folders.map((folder) => (
                <FolderRow
                    key={folder.id}
                    location={folder}
                    disabled={removing}
                    onRemove={() => onRemove(folder.id)}
                />
            ))}
        </ul>
    );
}

/** The folder added is another project's: merge that project into this one, or keep them apart. */
function MergeAsk({
    from,
    into,
    merging,
    onKeepApart,
    onMerge,
}: {
    from: string;
    into: string;
    merging: boolean;
    onKeepApart: () => void;
    onMerge: () => void;
}) {
    const { t } = useTranslation();
    return (
        <div
            role="alert"
            className="flex flex-col gap-2 rounded-lg bg-ui-surface-subtle p-2.5 text-[13px]"
        >
            <p>{t('projects.mergeAsk', { name: from, into })}</p>
            <div className="flex justify-end gap-2">
                <button type="button" className="btn-ghost-sm" onClick={onKeepApart}>
                    {t('projects.keepApart')}
                </button>
                <button
                    type="button"
                    className="btn-primary-sm"
                    disabled={merging}
                    onClick={onMerge}
                >
                    {t('projects.merge')}
                </button>
            </div>
        </div>
    );
}
