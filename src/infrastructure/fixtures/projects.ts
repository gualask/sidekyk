import type { Opened, ProjectList, ProjectsPort } from '@/modules/projects';
import type { ProjectFolder, ProjectInfo, ProjectLocation } from '@/shared/projects/project-info';
import { newAvatar } from './projects.fixture';
import {
    ADDED_FOLDERS,
    initialProjects,
    PICKED_FOLDERS,
    pickedLocation,
    pickedParent,
} from './projects.fixture-data';
import { failure, newId, type Scenario } from './scenario';

/** A folder found at `location`, with a new id, as the backend makes one for a project. */
function newFolder(location: ProjectLocation): ProjectFolder {
    return { ...location, id: newId() };
}

/** Whether one of two roots is the other or inside it, as `Location::overlaps` (one machine). */
function overlaps(a: string, b: string): boolean {
    const inside = (root: string, of: string) => root === of || root.startsWith(`${of}/`);
    return inside(a, b) || inside(b, a);
}

/** The project list in memory, as the backend keeps it, and the folder the window shows. */
export interface FixtureProjects {
    list: () => ProjectList;
    update: (next: ProjectList) => ProjectList;
    /** A project of the list, by its id; `project_not_found` for any other. */
    project: (projectId: string) => ProjectInfo;
    /** As `ProjectList::folder`: a folder of a project of the list, by its id. */
    folder: (folderId: string) => ProjectFolder;
    /** The folder the window shows, as it last told it (`showProjectFolder`). */
    show: (folderId: string | null) => void;
    /** The id of the folder on screen, when it is that project's. */
    shownFolderOf: (projectId: string | null) => string | null;
    /**
     * The folder a project shows, by the project's name, which `sidekykDev` names it by: the one
     * on screen, else its first.
     */
    shownOf: (name: string) => ProjectFolder | null;
}

export function fixtureProjectList(scenario: Scenario): FixtureProjects {
    const projects = initialProjects(scenario);
    let list: ProjectList = {
        projects,
        active: projects[0]?.id ?? null,
        layouts: {},
    };
    let onScreen: string | null = null;
    return {
        list: () => list,
        update: (next) => {
            list = next;
            return list;
        },
        project: (projectId) => {
            const found = list.projects.find((p) => p.id === projectId);
            if (!found) throw failure('project_not_found');
            return found;
        },
        folder: (folderId) => {
            const found = list.projects
                .flatMap((p) => p.folders)
                .find((candidate) => candidate.id === folderId);
            if (!found) throw failure('project_not_found');
            return found;
        },
        show: (folderId) => {
            onScreen = folderId;
        },
        shownFolderOf: (projectId) => {
            const found = list.projects.find((p) => p.id === projectId);
            return found?.folders.some((f) => f.id === onScreen) ? onScreen : null;
        },
        shownOf: (name) => {
            const found = list.projects.find((p) => p.name === name);
            return found?.folders.find((f) => f.id === onScreen) ?? found?.folders[0] ?? null;
        },
    };
}

/**
 * The projects port on `projects`, and what stands in for `sidekyk <folder>`. `notes.drop` takes a
 * removed project's notes.
 */
export function fixtureProjectsPort(
    projects: FixtureProjects,
    notes: { drop: (book: string) => void },
): { port: ProjectsPort; openFolder: (name: string) => void } {
    const { list, update, project, folder } = projects;
    // the project following the folder at `root`, if one does
    const projectAt = (root: string) =>
        list().projects.find((p) => p.folders.some((f) => f.root === root));
    const followed = (root: string) => projectAt(root) !== undefined;
    // as in `src-tauri/crates/core/src/modules/projects/list.rs`: a project removed takes its
    // notes; when on screen, the next project shows, else the previous
    const removeProject = (projectId: string) => {
        const current = list();
        const index = current.projects.indexOf(project(projectId));
        notes.drop(projectId);
        const remaining = current.projects.filter((p) => p.id !== projectId);
        const next = remaining[index] ?? remaining.at(-1) ?? null;
        const { [projectId]: _gone, ...layouts } = current.layouts;
        return update({
            projects: remaining,
            active: current.active === projectId ? (next?.id ?? null) : current.active,
            layouts,
        });
    };
    const projectsChanged = new Set<() => void>();
    const tellProjectsChanged = () => {
        for (const listener of projectsChanged) listener();
    };
    // what a folder given on the command line did, until the app takes it
    let opened: Opened | null = null;
    // how many folders the picker gave, for the next answer of `PICKED_FOLDERS`
    let pickedFolders = 0;
    // how many folders were added to a project, for the next of `ADDED_FOLDERS`
    let addedFolders = 0;

    const openFolder = (name: string) => {
        // above repositories of no project: nothing changes, the dialog asks
        if (name === 'Projects' && !list().projects.some((p) => p.name === name)) {
            const choice = pickedParent(list());
            if (choice.kind === 'usable' && choice.repositories.some((r) => r.inProject === null)) {
                opened = { kind: 'choice', choice };
                tellProjectsChanged();
                return;
            }
        }
        const found = list().projects.find((p) => p.name === name);
        const shown: ProjectInfo = found ?? {
            id: newId(),
            name,
            folders: [newFolder({ kind: 'local', root: `/Users/dev/Projects/${name}` })],
            avatar: newAvatar(list().projects),
        };
        const all = found ? list().projects : [...list().projects, shown];
        update({ ...list(), projects: all, active: shown.id });
        opened = { kind: 'project', id: shown.id, folderId: shown.folders[0].id };
        tellProjectsChanged();
    };

    const port: ProjectsPort = {
        getProjects: async () => list(),
        takeOpened: async () => {
            const taken = opened;
            opened = null;
            return taken;
        },
        chooseProjectFolder: async () => {
            const picked = PICKED_FOLDERS[pickedFolders % PICKED_FOLDERS.length](list());
            pickedFolders += 1;
            return picked;
        },
        // as `ProjectList::add`, then on screen; the folders are those picked, checked again
        createProject: async (name, paths) => {
            const locations = paths.map((path) => {
                const location = pickedLocation(path);
                if (!location) throw failure('repository_missing');
                return location;
            });
            if (locations.some((location) => followed(location.root))) {
                throw failure('unknown');
            }
            const made: ProjectInfo = {
                id: newId(),
                name: name.trim(),
                folders: locations.map(newFolder),
                avatar: newAvatar(list().projects),
            };
            return update({ ...list(), projects: [...list().projects, made], active: made.id });
        },
        editProject: async (projectId, name, avatar) => {
            const edited = project(projectId);
            const letters = avatar.letters?.trim() || null;
            return update({
                ...list(),
                projects: list().projects.map((p) =>
                    p === edited ? { ...p, name: name.trim(), avatar: { ...avatar, letters } } : p,
                ),
            });
        },
        activateProject: async (projectId) => update({ ...list(), active: project(projectId).id }),
        removeProject: async (projectId) => removeProject(projectId),
        // in `problems`, the moved folder is found next to where it was; it keeps its id
        relocateFolder: async (folderId) => {
            const moved = folder(folderId);
            const root = `${moved.root}-moved`;
            const other = projectAt(root);
            if (other) return { kind: 'inProject', id: other.id, name: other.name };
            return {
                kind: 'changed',
                list: update({
                    ...list(),
                    projects: list().projects.map((p) => ({
                        ...p,
                        folders: p.folders.map((f) => (f === moved ? { ...f, root } : f)),
                    })),
                }),
            };
        },
        showProjectFolder: async (folderId) => projects.show(folderId),
        // in turn: a repository no project follows, another project's folder (to merge it),
        // the parent of repositories (one of them the project's: refused)
        addProjectFolder: async (projectId) => {
            const target = project(projectId);
            const picked = ADDED_FOLDERS[addedFolders % ADDED_FOLDERS.length];
            addedFolders += 1;
            const { root } = picked.location;
            const other = projectAt(root);
            if (other && other !== target) {
                return { kind: 'inProject', id: other.id, name: other.name };
            }
            if (target.folders.some((f) => f.kind !== 'local')) {
                throw failure('folder_elsewhere');
            }
            if (target.folders.some((f) => overlaps(f.root, root))) {
                throw failure('folder_overlaps');
            }
            const added = newFolder(picked.location);
            return {
                kind: 'changed',
                list: update({
                    ...list(),
                    projects: list().projects.map((p) =>
                        p === target ? { ...p, folders: [...p.folders, added] } : p,
                    ),
                }),
            };
        },
        removeProjectFolder: async (projectId, folderId) => {
            const target = project(projectId);
            if (!target.folders.some((f) => f.id === folderId)) {
                throw failure('project_not_found');
            }
            return update({
                ...list(),
                projects: list().projects.map((p) =>
                    p === target
                        ? { ...p, folders: p.folders.filter((f) => f.id !== folderId) }
                        : p,
                ),
            });
        },
        // as `merge_projects`: the folders follow, the notes move (`fixtureNotes` keeps them
        // per project: they stay behind here), the project merged goes
        mergeProjects: async (into, from) => {
            const target = project(into);
            const merged = project(from);
            if (target === merged) throw failure('unknown');
            const machines = new Set(
                [...target.folders, ...merged.folders].map((f) =>
                    f.kind === 'wsl' ? f.distro : '',
                ),
            );
            if (machines.size > 1) throw failure('folder_elsewhere');
            if (merged.folders.some((m) => target.folders.some((t) => overlaps(t.root, m.root)))) {
                throw failure('folder_overlaps');
            }
            const wasActive = list().active === from;
            removeProject(from);
            return update({
                ...list(),
                projects: list().projects.map((p) =>
                    p.id === into ? { ...p, folders: [...p.folders, ...merged.folders] } : p,
                ),
                active: wasActive ? into : list().active,
            });
        },
        setProjectLayout: async (projectId, layout) =>
            update({ ...list(), layouts: { ...list().layouts, [project(projectId).id]: layout } }),
        onProjectsChanged: (listener) => {
            projectsChanged.add(listener);
            // once as the listening starts, as the backend's adapter
            queueMicrotask(() => {
                if (projectsChanged.has(listener)) listener();
            });
            return () => projectsChanged.delete(listener);
        },
    };
    return { port, openFolder };
}
