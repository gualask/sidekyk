import { Dialog } from '@base-ui/react/dialog';
import { type FormEvent, useRef, useState } from 'react';
import { errorMessage } from '@/shared/errors/app-error';
import { useTranslation } from '@/shared/i18n';
import { useChooseProjectFolder, useCreateProject } from '../application/projects.queries';
import {
    freeRepositories,
    isParent,
    type ParentUse,
    type PickedFolder,
    parentFolders,
    withFolder,
} from '../model/new-project';
import type { FolderChoice } from '../model/project.types';
import {
    FolderMessage,
    type FolderNotice,
    ParentChoice,
    type PickedParent,
} from './new-project-fields';
import { FolderList, NameField } from './project-fields';

/**
 * New project, the same for everyone: a name, and folders if wanted (any folder, inside a
 * repository the repository's: the first one's name fills an empty name). A folder that is another
 * project's is said under the folders and not taken. A folder without git picked first, with
 * repositories right inside it (a parent of api and web), asks what it becomes: one project with
 * them, a project each, or itself. `↵` creates. Loaded with its first opening.
 */
export function NewProjectDialog({
    picked = null,
    onCreated,
    onOpenProject,
    onClose,
}: {
    /** A folder already picked, as a folder given on the command line: the dialog starts on it. */
    picked?: FolderChoice | null;
    /** The new project, now selected: show it. */
    onCreated: (projectId: string) => void;
    /** Shows the project the folder picked already is. */
    onOpenProject: (projectId: string) => void;
    onClose: () => void;
}) {
    const [name, setName] = useState(picked?.kind === 'usable' ? picked.name : '');
    // a folder's name fills the name while it is empty
    const fillName = (folder: string) =>
        setName((current) => (current.trim() === '' ? folder : current));
    const { shown, parent, setUse, notice, choose, chooseFolder, removeFolder } = usePickedFolders(
        picked,
        fillName,
    );
    const create = useCreateProject();
    const nameField = useRef<HTMLInputElement>(null);
    const i18n = useTranslation();
    const { t, tp } = i18n;
    const each = parent?.use === 'each';

    const blank = !each && name.trim() === '';
    const submit = async (event: FormEvent) => {
        event.preventDefault();
        if (blank || create.isPending) return;
        let made: string | null;
        try {
            made = await makeInTurn(projectsToMake(name, shown, each ? parent : null), (project) =>
                create.mutateAsync(project),
            );
        } catch {
            // said in the dialog, still open
            return;
        }
        onClose();
        if (made) onCreated(made);
    };
    const repositories = parent ? freeRepositories(parent.folder).length : 0;

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
                        {t('projects.new')}
                    </Dialog.Title>
                    <form className="mt-3 flex flex-col gap-3" onSubmit={(e) => void submit(e)}>
                        <NameField
                            value={name}
                            onChange={setName}
                            inputRef={nameField}
                            disabled={each}
                        />
                        <fieldset className="flex min-w-0 flex-col gap-1.5">
                            <legend className="mb-1 text-xs font-semibold">
                                {t('projects.foldersOptional')}
                            </legend>
                            {parent ? <ParentChoice parent={parent} onUse={setUse} /> : null}
                            <FolderList
                                folders={shown.map((folder) => ({
                                    key: folder.path,
                                    location: folder.location,
                                }))}
                                onRemove={each ? null : removeFolder}
                            />
                            {each ? null : (
                                <div>
                                    <button
                                        type="button"
                                        className="btn-ghost-sm"
                                        disabled={choose.isPending}
                                        onClick={() => void chooseFolder()}
                                    >
                                        {t('projects.addFolder')}
                                    </button>
                                </div>
                            )}
                            <FolderMessage
                                notice={notice}
                                error={choose.isError ? errorMessage(choose.error, i18n) : null}
                                onOpen={(id) => {
                                    onClose();
                                    onOpenProject(id);
                                }}
                            />
                        </fieldset>
                        {create.isError ? (
                            <p role="alert" className="text-xs text-ui-danger">
                                {errorMessage(create.error, i18n)}
                            </p>
                        ) : null}
                        <div className="mt-1 flex justify-end gap-2">
                            <Dialog.Close className="btn-ghost-sm">
                                {t('common.cancel')}
                            </Dialog.Close>
                            <button
                                type="submit"
                                className="btn-primary-sm"
                                disabled={blank || create.isPending}
                            >
                                {each
                                    ? tp('projects.createEach', repositories)
                                    : t('projects.create')}
                            </button>
                        </div>
                    </form>
                </Dialog.Popup>
            </Dialog.Portal>
        </Dialog.Root>
    );
}

/**
 * The folders the new project will follow, as they are picked: those picked one by one, a parent
 * of repositories picked first and what it becomes, and why the last one picked was not taken.
 * `fillName` gets a folder's name as one is taken. Starts on `picked`, if any.
 */
function usePickedFolders(picked: FolderChoice | null, fillName: (name: string) => void) {
    const usable = picked?.kind === 'usable' ? picked : null;
    const [folders, setFolders] = useState<PickedFolder[]>(() =>
        usable && !isParent(usable) ? [{ path: usable.path, location: usable.location }] : [],
    );
    const [parent, setParent] = useState<PickedParent | null>(() =>
        usable && isParent(usable) ? { folder: usable, use: 'together' } : null,
    );
    const [notice, setNotice] = useState<FolderNotice | null>(
        picked?.kind === 'inProject' ? picked : null,
    );
    const choose = useChooseProjectFolder();

    /** Asks for a folder: taken, asked about (a parent picked first), or said not taken. */
    const chooseFolder = async () => {
        const choice = await choose.mutateAsync().catch(() => null);
        if (!choice) return;
        if (choice.kind !== 'usable') {
            setNotice(choice);
            return;
        }
        setNotice(null);
        fillName(choice.name);
        // only the first folder picked is asked about: later ones join as they are
        if (folders.length === 0 && !parent && isParent(choice)) {
            setParent({ folder: choice, use: 'together' });
            return;
        }
        setFolders((all) => withFolder(all, { path: choice.path, location: choice.location }));
    };
    /** Leaves the folder at `path` out. */
    const removeFolder = (path: string) => {
        if (parent && !folders.some((f) => f.path === path)) {
            // one of the parent's: the others stay as folders picked, the choice asked no more
            const rest = parentFolders(parent.folder, parent.use).filter((f) => f.path !== path);
            setFolders((all) => [...rest, ...all]);
            setParent(null);
            return;
        }
        setFolders((all) => all.filter((f) => f.path !== path));
    };
    const shown = parent ? [...parentFolders(parent.folder, parent.use), ...folders] : folders;
    return {
        /** In their order: the parent's, as its use says, then those picked one by one. */
        shown,
        parent,
        setUse: (use: ParentUse) => setParent((held) => held && { ...held, use }),
        notice,
        /** The asking, for whether it runs or failed. */
        choose,
        chooseFolder,
        removeFolder,
    };
}

/** A project to make: its name and its folders' paths. */
interface NewProject {
    name: string;
    folders: string[];
}

/** The project named `name` with the folders `shown`, or one per free repository of `each`. */
function projectsToMake(
    name: string,
    shown: PickedFolder[],
    each: PickedParent | null,
): NewProject[] {
    if (!each) return [{ name, folders: shown.map((folder) => folder.path) }];
    return freeRepositories(each.folder).map((repository) => ({
        name: repository.name,
        folders: [repository.path],
    }));
}

/** Makes `projects` one after the other, so the last made is the one on screen: that one. */
async function makeInTurn(
    projects: NewProject[],
    make: (project: NewProject) => Promise<{ active: string | null }>,
): Promise<string | null> {
    let made: string | null = null;
    for (const project of projects) {
        made = (await make(project)).active;
    }
    return made;
}
