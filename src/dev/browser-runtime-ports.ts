import type { RuntimePorts } from '@/infrastructure/platform/runtime';
import { INBOX_BOOK } from '@/modules/notes';
import type { FolderChoice, Opened, ProjectList } from '@/modules/projects';
import type { FileContent, FolderKind, RepositoryChangedEvent } from '@/modules/repository';
import type { GlobalShortcutStatuses, Settings, ShortcutAction } from '@/modules/settings';
import { DEFAULT_COPY_TEMPLATE } from '@/shared/copy/copy-template';
import {
    type ProjectFolder,
    type ProjectInfo,
    type ProjectLocation,
    projectFolder,
} from '@/shared/projects/project-info';
import { commitActivity, commitFileDiff, commitFiles, recentCommits } from './commits.fixture-data';
import {
    FRESH_VAULT_PATHS,
    fixtureFileContent,
    fixtureFolderTree,
    fixtureTree,
} from './files.fixture-data';
import {
    editedText,
    FIXTURE_BLOBS,
    fixturePreview,
    REPOSITORY_IMAGES,
    VAULT_IMAGES,
} from './fixture-files';
import { fixtureContentSearch, fixtureRankNames, fixtureSearch } from './fixture-search';
import { largeDiff, largeSnapshot } from './large.fixture-data';
import { fixtureNotes } from './notes.fixture';
import { localProject, wslProject } from './projects.fixture';
import {
    FIXTURE_REPOSITORY,
    fixtureIgnoringWhitespace,
    reviewDiff,
    reviewSnapshot,
} from './review.fixture-data';
import { type FixtureTexts, fixtureColors, fixtureVersionText } from './syntax.fixture';
import { wholeFileDiff } from './whole-file.fixture';

export const SCENARIOS = ['review', 'clean', 'no-repo', 'large', 'problems'] as const;
export type Scenario = (typeof SCENARIOS)[number];

export function isScenario(value: string | null): value is Scenario {
    return SCENARIOS.includes(value as Scenario);
}

/** Projects with a clean working tree, next to the scenario's own. */
const CLEAN_PROJECTS: ProjectInfo[] = [
    localProject('/Users/dev/Projects/docs-site', 'docs-site'),
    localProject('/Users/dev/Projects/api-gateway', 'api-gateway'),
];

/** In `review`: a clone of the scenario's repository in a WSL distro, clean, of the same name. */
const WSL_PROJECT = wslProject('Ubuntu', '/home/dev/shop', 'shop');

/** In `review` and `clean`: a project without folder, notes on a topic. */
const TOPIC_PROJECT: ProjectInfo = { id: 'b0000000000000a1', name: 'Thesis', folders: [] };

/** In `review` and `clean`: a folder without git, notes in Markdown (`sidekykDev.gitInit`). */
const VAULT_ROOT = '/Users/dev/Notes/vault';
const VAULT_PROJECT = localProject(VAULT_ROOT, 'Vault');

/** The repository the folder picker finds, a folder inside it picked. */
const PICKED_REPOSITORY = {
    kind: 'usable',
    path: '/Users/dev/Projects/api-gateway/src',
    name: 'api-gateway',
    location: { kind: 'local', root: '/Users/dev/Projects/api-gateway' },
    repositories: [],
} as const satisfies FolderChoice;

/** A folder without git the folder picker finds. */
const PICKED_PLAIN = {
    kind: 'usable',
    path: '/Users/dev/Documents/papers',
    name: 'papers',
    location: { kind: 'local', root: '/Users/dev/Documents/papers' },
    repositories: [],
} as const satisfies FolderChoice;

/** A folder without git the folder picker finds, with repositories right inside it. */
const PARENT_ROOT = '/Users/dev/Projects';
const INSIDE_PARENT = ['api-gateway', 'billing', 'docs-site', 'shop'];

/** The parent of repositories picked, each said whose it is in `list`. */
function pickedParent(list: ProjectList): FolderChoice {
    return {
        kind: 'usable',
        path: PARENT_ROOT,
        name: 'Projects',
        location: { kind: 'local', root: PARENT_ROOT },
        repositories: INSIDE_PARENT.map((name) => {
            const root = `${PARENT_ROOT}/${name}`;
            const project = list.projects.find((p) => p.folders.some((f) => f.root === root));
            return {
                path: root,
                name,
                location: { kind: 'local', root },
                inProject: project?.name ?? null,
            };
        }),
    };
}

/** Where a path the picker gave is: a folder picked, or a repository inside the parent. */
function pickedLocation(path: string): ProjectLocation | null {
    const picked = [PICKED_REPOSITORY, PICKED_PLAIN].find((p) => p.path === path);
    if (picked) return picked.location;
    const inside = INSIDE_PARENT.some((name) => path === `${PARENT_ROOT}/${name}`);
    return inside || path === PARENT_ROOT ? { kind: 'local', root: path } : null;
}

/** The folders without git, until `sidekykDev.gitInit`: they list notes in Markdown. */
const DOCUMENT_ROOTS: readonly string[] = [VAULT_ROOT, PICKED_PLAIN.location.root, PARENT_ROOT];

/**
 * What the folder picker gives in turn, to see each answer of the New project dialog: a parent of
 * repositories, a repository no project follows, the scenario's own repository, then a folder
 * without git.
 */
const PICKED_FOLDERS: readonly ((list: ProjectList) => FolderChoice)[] = [
    pickedParent,
    () => PICKED_REPOSITORY,
    (list) =>
        list.projects.some((p) => p.id === FIXTURE_REPOSITORY.id)
            ? { kind: 'inProject', id: FIXTURE_REPOSITORY.id, name: FIXTURE_REPOSITORY.name }
            : PICKED_PLAIN,
    () => PICKED_PLAIN,
];

/** What the folder picker gives in turn to add a folder to a project. */
const ADDED_FOLDERS: readonly { location: ProjectLocation }[] = [
    PICKED_REPOSITORY,
    { location: { kind: 'local', root: CLEAN_PROJECTS[0].folders[0].root } },
    { location: { kind: 'local', root: PARENT_ROOT } },
];

/** In `problems`: a project whose repository was moved or deleted after it was added. */
const MISSING_PROJECT = localProject('/Users/dev/Projects/old-prototype', 'old-prototype');

/**
 * In `problems`, WSL projects: a distro that does not run (until the project opens), one gone, one
 * without git.
 */
const STOPPED_PROJECT = wslProject('Debian', '/home/dev/api', 'api');
const GONE_PROJECT = wslProject('Arch', '/home/dev/dotfiles', 'dotfiles');
const NO_GIT_PROJECT = wslProject('Alpine', '/home/dev/tools', 'tools');

/** How long Sidekyk's helper takes to start in a distro, as the first read of a WSL project waits. */
const HELPER_START_MS = 1500;

/**
 * In `review`: the scenario's project with a second repository beside its own, clean, to switch
 * between them.
 */
const TWO_FOLDER_PROJECT: ProjectInfo = {
    ...FIXTURE_REPOSITORY,
    folders: [
        ...FIXTURE_REPOSITORY.folders,
        { id: 'c0000000000000f2', kind: 'local', root: '/Users/dev/Projects/shop-web' },
    ],
};

function initialProjects(scenario: Scenario): ProjectInfo[] {
    if (scenario === 'no-repo') return [];
    if (scenario === 'review') {
        return [TWO_FOLDER_PROJECT, CLEAN_PROJECTS[0], WSL_PROJECT, VAULT_PROJECT, TOPIC_PROJECT];
    }
    if (scenario === 'problems') {
        return [FIXTURE_REPOSITORY, MISSING_PROJECT, STOPPED_PROJECT, GONE_PROJECT, NO_GIT_PROJECT];
    }
    if (scenario === 'clean') return [FIXTURE_REPOSITORY, VAULT_PROJECT, TOPIC_PROJECT];
    return [FIXTURE_REPOSITORY];
}

/** Shortcuts macOS keeps on by default: registered, but macOS gets them first. */
const MACOS_SHORTCUTS = ['Super+Space', 'Alt+Super+Space', 'Control+Super+Space'];

/** As the system answers, to see the warning: `⇧⌘Space` held by another app. */
const TAKEN_SHORTCUTS = ['Shift+Super+Space'];

const STORED_SHORTCUT = 'Control+Alt+Space';
const STORED_CAPTURE_SHORTCUT = 'Control+Alt+KeyC';

/** A native command's failure, as the backend sends it. */
function failure(code: string) {
    return { code, message: code };
}

let idSeq = 0;
/** 16 hex digits, as the backend's new project and folder ids. */
function newId(): string {
    idSeq += 1;
    return (0xa0000000 + idSeq).toString(16).padStart(16, '0');
}

/** A folder found at `location`, with a new id, as the backend makes one for a project. */
function newFolder(location: ProjectLocation): ProjectFolder {
    return { ...location, id: newId() };
}

/** Whether one of two roots is the other or inside it, as `Location::overlaps` (one machine). */
function overlaps(a: string, b: string): boolean {
    const inside = (root: string, of: string) => root === of || root.startsWith(`${of}/`);
    return inside(a, b) || inside(b, a);
}

/** The fixtures' runtime: the ports, and what stands in for the command line. */
export interface BrowserRuntime {
    ports: RuntimePorts;
    /**
     * As `sidekyk <folder>` (`open_folder`): the project of that name, else one added for a folder
     * of that name; on screen, and the frontend told the list changed.
     */
    openFolder: (name: string) => void;
    /** As `git init` in the folder of the project of that name, its watcher telling the change. */
    gitInit: (name: string) => void;
    /** As its `.git` removed. */
    gitRemove: (name: string) => void;
    /** As `wsl --shutdown` of the distro of the project of that name: started again by a read. */
    stopDistro: (name: string) => void;
    /**
     * As an agent writing a file of the project of that name, its watcher telling the change:
     * `text`, or the fixtures' later version of it (`fixture-files/edits/`), whose preview is
     * the backend's.
     */
    writeFile: (name: string, path: string, text?: string) => void;
}

/** Browser-safe ports for `?dev=…` fixtures: fixed data, no native backend. */
export function createBrowserRuntime(scenario: Scenario): BrowserRuntime {
    const projects = initialProjects(scenario);
    let list: ProjectList = {
        projects,
        active: projects[0]?.id ?? null,
        layouts: {},
    };
    // the folder the window shows, as it last told it (`showProjectFolder`)
    let onScreen: string | null = null;
    const project = (projectId: string) => {
        const found = list.projects.find((p) => p.id === projectId);
        if (!found) throw failure('project_not_found');
        return found;
    };
    // as `ProjectList::folder`: a folder of a project of the list, by its id
    const folder = (folderId: string) => {
        const found = list.projects
            .flatMap((p) => p.folders)
            .find((candidate) => candidate.id === folderId);
        if (!found) throw failure('project_not_found');
        return found;
    };
    // the id of the folder on screen, when it is that project's
    const shownFolderOf = (projectId: string | null) => {
        const found = list.projects.find((p) => p.id === projectId);
        return found?.folders.some((f) => f.id === onScreen) ? onScreen : null;
    };
    // the project following the folder at `root`, if one does
    const projectAt = (root: string) =>
        list.projects.find((p) => p.folders.some((f) => f.root === root));
    const followed = (root: string) => projectAt(root) !== undefined;
    // the folder a project shows, by the project's name, which `sidekykDev` names it by: the one
    // on screen, else its first
    const shownOf = (name: string) => {
        const found = list.projects.find((p) => p.name === name);
        return found?.folders.find((f) => f.id === onScreen) ?? found?.folders[0] ?? null;
    };
    const update = (next: ProjectList) => {
        list = next;
        return list;
    };
    // a browser tab follows the system's theme, or the one the devtools emulate: the setting is
    // only kept
    let settings: Settings = {
        language: null,
        theme: 'dark',
        globalShortcut: { enabled: true, keys: STORED_SHORTCUT },
        captureShortcut: { enabled: true, keys: STORED_CAPTURE_SHORTCUT },
        diffView: 'changes',
        fileView: 'preview',
        diffScrollbar: 'narrow',
        codeLines: 'scroll',
        copyTemplate: DEFAULT_COPY_TEMPLATE,
        sidebarWidths: {},
        noteLines: 'wrap',
    };
    // in `problems`, another app holds the stored shortcut since startup
    const taken = scenario === 'problems' ? [...TAKEN_SHORTCUTS, STORED_SHORTCUT] : TAKEN_SHORTCUTS;
    const shortcutStatus: GlobalShortcutStatuses = {
        toggle: taken.includes(STORED_SHORTCUT)
            ? { kind: 'refused', keys: STORED_SHORTCUT }
            : { kind: 'active', keys: STORED_SHORTCUT, conflict: false },
        capture: { kind: 'active', keys: STORED_CAPTURE_SHORTCUT, conflict: false },
    };
    // the scenario's data belongs to its first project, and its folder, of the same id; any other
    // is clean
    const scenarioData = (folderId: string) =>
        folderId === FIXTURE_REPOSITORY.id && scenario !== 'clean';
    const rootOf = (folderId: string) => folder(folderId).root;
    // what is a folder without git, by its root: `gitInit` and `gitRemove` change it
    const plainRoots = new Set(DOCUMENT_ROOTS);
    const kindOf = (folderId: string): FolderKind =>
        plainRoots.has(rootOf(folderId)) ? 'plain' : 'repository';
    // the folder is there, no git asked
    const present = (folderId: string) => {
        // missing where it was, not where Locate… finds it
        if (rootOf(folderId) === projectFolder(MISSING_PROJECT)?.root) {
            throw failure('repository_missing');
        }
        if (folderId === GONE_PROJECT.id) throw failure('distro_missing');
    };
    // a repository git can read: the frontend never asks a folder without git
    const readable = (folderId: string) => {
        present(folderId);
        if (folderId === NO_GIT_PROJECT.id) throw failure('git_not_found');
        if (kindOf(folderId) === 'plain') throw failure('unknown');
    };
    // as the backend: the kind and the summary never start a distro, the Start panel does; a
    // distro running gets its helper started by the first read
    const running = new Set(['Ubuntu', 'Alpine']);
    const helpers = new Set<string>();
    const distroOf = (folderId: string) => {
        const found = folder(folderId);
        return found.kind === 'wsl' ? found.distro : null;
    };
    // `distro_stopped` unless the project's distro runs, as `readable_without_starting`
    const readableWithoutStarting = (folderId: string) => {
        const distro = distroOf(folderId);
        if (distro && !helpers.has(distro) && !running.has(distro)) {
            throw failure('distro_stopped');
        }
    };
    // the helper takes a while the first time, the distro started with it
    const startHelper = async (folderId: string) => {
        const distro = distroOf(folderId);
        if (distro && !helpers.has(distro)) {
            await new Promise((started) => setTimeout(started, HELPER_START_MS));
            helpers.add(distro);
            running.add(distro);
        }
    };
    const large = (folderId: string) => scenario === 'large' && scenarioData(folderId);
    const snapshot = (folderId: string) => {
        readable(folderId);
        if (large(folderId)) return largeSnapshot();
        return reviewSnapshot(!scenarioData(folderId));
    };

    // a folder without git holds the Vault's images, the repository its own
    const imagesOf = (folderId: string) =>
        DOCUMENT_ROOTS.includes(rootOf(folderId)) ? VAULT_IMAGES : REPOSITORY_IMAGES;

    // as the backend, the tree is built once and kept: the fixtures never change on disk
    const trees = new Map<string, ReturnType<typeof fixtureTree>>();
    const tree = (folderId: string) => {
        present(folderId);
        let found = trees.get(folderId);
        if (!found) {
            found = DOCUMENT_ROOTS.includes(rootOf(folderId))
                ? fixtureFolderTree()
                : fixtureTree(large(folderId), snapshot(folderId).files);
            trees.set(folderId, found);
        }
        return found;
    };

    // as the backend, the palette searches the files of the tree, as the last snapshot found them
    // changed: none when they cannot be read
    const searchedFiles = (folderId: string | null) => {
        if (!folderId) return null;
        try {
            readableWithoutStarting(folderId);
            const changed = kindOf(folderId) === 'plain' ? [] : snapshot(folderId).files;
            return { paths: tree(folderId).files, changed };
        } catch {
            return null;
        }
    };

    // as in `src-tauri/crates/core/src/modules/projects/list.rs`: a project removed takes its
    // notes; when on screen, the next project shows, else the previous
    const removeProject = (projectId: string) => {
        const index = list.projects.indexOf(project(projectId));
        notes.drop(projectId);
        const projects = list.projects.filter((p) => p.id !== projectId);
        const next = projects[index] ?? projects.at(-1) ?? null;
        const { [projectId]: _gone, ...layouts } = list.layouts;
        return update({
            projects,
            active: list.active === projectId ? (next?.id ?? null) : list.active,
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
    // as the backend, notes need the Inbox or a project in the list, not its repository: a moved
    // one's stay
    const notes = fixtureNotes({
        initial: (book) => {
            if (book === INBOX_BOOK) {
                return scenario === 'review' || scenario === 'clean' ? 'inbox' : 'empty';
            }
            if (book === TOPIC_PROJECT.id) return 'topic';
            if (!scenarioData(book)) return 'empty';
            return large(book) ? 'large' : 'review';
        },
        checkBook: (book) => {
            if (book !== INBOX_BOOK) project(book);
        },
        // as `ProjectList::add`: last, without folder, on screen only when none was
        makeProject: (name) => {
            const made: ProjectInfo = { id: newId(), name: name.trim(), folders: [] };
            const active = list.active ?? made.id;
            update({ ...list, projects: [...list.projects, made], active });
            return made.id;
        },
        dropProject: removeProject,
        projectsChanged: tellProjectsChanged,
    });
    // as the backend, the palette searches the notes of the project on screen, or at all projects
    // those of every book, the Inbox first
    const searchedNotes = (projectId: string | null) => {
        const books = projectId ? [projectId] : [INBOX_BOOK, ...list.projects.map((p) => p.id)];
        return books.flatMap((book) => {
            try {
                return [[book, notes.peek(book)] as const];
            } catch {
                return [];
            }
        });
    };

    // the versions a diff compares, from the diffs and files served below
    const texts = (folderId: string): FixtureTexts => ({
        changeDiff: (area, path) => {
            // a folder without git has no changes
            if (kindOf(folderId) === 'plain') return null;
            if (!snapshot(folderId).files.some((f) => f.area === area && f.path === path))
                return null;
            const diff = large(folderId)
                ? wholeFileDiff(largeDiff())
                : reviewDiff({ area, path, wholeFile: true });
            return diff.text;
        },
        fileText: (path) => {
            if (!tree(folderId).has(path)) return null;
            const content = fixtureFileContent(path);
            return content.kind === 'text' ? content.text : null;
        },
        commitDiff: (sha, path) => {
            for (const { sha: commitSha, parent } of recentCommits(large(folderId)).commits) {
                const side = commitSha === sha ? 'new' : parent === sha ? 'old' : null;
                if (!side) continue;
                const commit = { sha: commitSha, parent };
                const file = commitFiles(large(folderId), commit).files.find(
                    (f) => (side === 'new' ? f.path : (f.origPath ?? f.path)) === path,
                );
                if (!file) continue;
                const request = { commit, path: file.path, origPath: file.origPath };
                const diff = commitFileDiff(large(folderId), { ...request, wholeFile: true });
                return { text: wholeFileDiff(diff).text, side };
            }
            return null;
        },
    });

    // as the watcher tells a `.git` come or gone at a folder's root
    const repositoryChanged = new Set<(event: RepositoryChangedEvent) => void>();
    // files written while the page runs (`writeFile`), by project and path
    const written = new Map<string, string>();
    const contentOf = (folderId: string, path: string): FileContent => {
        if (!tree(folderId).has(path)) throw failure('file_missing');
        const text = written.get(`${folderId}\0${path}`);
        return text === undefined
            ? fixtureFileContent(path)
            : { kind: 'text', text, truncated: false };
    };
    const writeFile = (name: string, path: string, text = editedText(name, path)) => {
        if (text === undefined)
            throw new Error(`No later version of ${path} in fixture-files/edits`);
        const shown = shownOf(name);
        if (!shown) throw new Error(`No project ${name} with a folder`);
        written.set(`${shown.id}\0${path}`, text);
        const event: RepositoryChangedEvent = {
            version: 5,
            folderId: shown.id,
            gitDir: false,
            paths: [path],
            kindChanged: false,
        };
        for (const listener of repositoryChanged) listener(event);
    };

    const setKind = (name: string, kind: FolderKind) => {
        const shown = shownOf(name);
        if (!shown) throw new Error(`No project ${name} with a folder`);
        if (kind === 'plain') plainRoots.add(shown.root);
        else plainRoots.delete(shown.root);
        const event: RepositoryChangedEvent = {
            version: 5,
            folderId: shown.id,
            gitDir: true,
            paths: null,
            kindChanged: true,
        };
        for (const listener of repositoryChanged) listener(event);
    };

    const openFolder = (name: string) => {
        // above repositories of no project: nothing changes, the dialog asks
        if (name === 'Projects' && !list.projects.some((p) => p.name === name)) {
            const choice = pickedParent(list);
            if (choice.kind === 'usable' && choice.repositories.some((r) => r.inProject === null)) {
                opened = { kind: 'choice', choice };
                tellProjectsChanged();
                return;
            }
        }
        const found = list.projects.find((p) => p.name === name);
        const shown: ProjectInfo = found ?? {
            id: newId(),
            name,
            folders: [newFolder({ kind: 'local', root: `/Users/dev/Projects/${name}` })],
        };
        const projects = found ? list.projects : [...list.projects, shown];
        update({ ...list, projects, active: shown.id });
        opened = { kind: 'project', id: shown.id, folderId: shown.folders[0].id };
        tellProjectsChanged();
    };

    const ports: RuntimePorts = {
        notes,
        projects: {
            getProjects: async () => list,
            takeOpened: async () => {
                const taken = opened;
                opened = null;
                return taken;
            },
            chooseProjectFolder: async () => {
                const picked = PICKED_FOLDERS[pickedFolders % PICKED_FOLDERS.length](list);
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
                };
                return update({ ...list, projects: [...list.projects, made], active: made.id });
            },
            renameProject: async (projectId, name) => {
                const renamed = project(projectId);
                return update({
                    ...list,
                    projects: list.projects.map((p) =>
                        p === renamed ? { ...p, name: name.trim() } : p,
                    ),
                });
            },
            activateProject: async (projectId) =>
                update({ ...list, active: project(projectId).id }),
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
                        ...list,
                        projects: list.projects.map((p) => ({
                            ...p,
                            folders: p.folders.map((f) => (f === moved ? { ...f, root } : f)),
                        })),
                    }),
                };
            },
            showProjectFolder: async (folderId) => {
                onScreen = folderId;
            },
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
                        ...list,
                        projects: list.projects.map((p) =>
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
                    ...list,
                    projects: list.projects.map((p) =>
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
                if (
                    merged.folders.some((m) => target.folders.some((t) => overlaps(t.root, m.root)))
                ) {
                    throw failure('folder_overlaps');
                }
                const wasActive = list.active === from;
                removeProject(from);
                return update({
                    ...list,
                    projects: list.projects.map((p) =>
                        p.id === into ? { ...p, folders: [...p.folders, ...merged.folders] } : p,
                    ),
                    active: wasActive ? into : list.active,
                });
            },
            setProjectLayout: async (projectId, layout) =>
                update({ ...list, layouts: { ...list.layouts, [project(projectId).id]: layout } }),
            onProjectsChanged: (listener) => {
                projectsChanged.add(listener);
                // once as the listening starts, as the backend's adapter
                queueMicrotask(() => {
                    if (projectsChanged.has(listener)) listener();
                });
                return () => projectsChanged.delete(listener);
            },
        },
        repository: {
            // as the backend: no git, and only the Start panel starts a distro
            getFolderKind: async (folderId, start) => {
                present(folderId);
                if (start) await startHelper(folderId);
                else readableWithoutStarting(folderId);
                return kindOf(folderId);
            },
            getSnapshot: async (folderId) => {
                readable(folderId);
                await startHelper(folderId);
                return snapshot(folderId);
            },
            getSummary: async (folderId) => {
                readable(folderId);
                readableWithoutStarting(folderId);
                return snapshot(folderId).summary;
            },
            getFileDiff: async (folderId, request) => {
                readable(folderId);
                if (!large(folderId)) return reviewDiff(request);
                return request.wholeFile ? wholeFileDiff(largeDiff()) : largeDiff();
            },
            getChangesIgnoringWhitespace: async (folderId) => {
                readable(folderId);
                return fixtureIgnoringWhitespace(snapshot(folderId).files);
            },
            // every project has the same history, even with a clean working tree
            getRecentCommits: async (folderId) => {
                readable(folderId);
                return recentCommits(large(folderId));
            },
            getCommitActivity: async (folderId, since) => {
                readable(folderId);
                if (scenarioData(folderId)) {
                    return commitActivity(large(folderId) ? 'large' : 'busy', since);
                }
                return commitActivity(folderId === CLEAN_PROJECTS[0].id ? 'quiet' : 'none', since);
            },
            getCommitFiles: async (folderId, commit) => {
                readable(folderId);
                return commitFiles(large(folderId), commit);
            },
            getCommitFileDiff: async (folderId, request) => {
                readable(folderId);
                const diff = commitFileDiff(large(folderId), request);
                return request.wholeFile ? wholeFileDiff(diff) : diff;
            },
            getDirectory: async (folderId, path) => tree(folderId).directory(path),
            // the changed files the newest, as an agent just wrote them
            getRecentFiles: async (folderId) => {
                const fresh =
                    kindOf(folderId) === 'plain'
                        ? FRESH_VAULT_PATHS
                        : snapshot(folderId)
                              .files.filter((file) => file.kind !== 'deleted')
                              .map((file) => file.path);
                return tree(folderId).recent(Date.now(), fresh);
            },
            getFileContent: async (folderId, path) => contentOf(folderId, path),
            // the fixtures' images, as Vite serves them; any other is missing
            getFileStamp: async (folderId, path) => {
                const image = imagesOf(folderId)[path];
                if (!tree(folderId).has(path) || !image) throw failure('file_missing');
                return { size: image.size, modified: 0 };
            },
            getBlobSize: async (folderId, blob) => {
                readable(folderId);
                const image = FIXTURE_BLOBS[blob];
                if (!image) throw failure('file_missing');
                return image.size;
            },
            projectFileUrl: (folderId, path, source) =>
                (source.kind === 'blob' ? FIXTURE_BLOBS[source.blob] : imagesOf(folderId)[path])
                    ?.url ?? '',
            getMarkdownPreview: async (folderId, path) => {
                // the backend's own preview of that text (`fixture-files/previews.json`)
                const content = contentOf(folderId, path);
                return content.kind === 'text' ? fixturePreview(content.text) : null;
            },
            // a browser tab opens it in another, as the system's browser would
            openUrl: async (url) => {
                window.open(url, '_blank', 'noopener,noreferrer');
            },
            getSyntaxColors: async (folderId, { path, version, first, count }) => {
                // as the backend: a file on disk is read without git
                if (version.kind === 'worktree') present(folderId);
                else readable(folderId);
                return fixtureColors(
                    fixtureVersionText(texts(folderId), path, version),
                    first,
                    count,
                );
            },
            onRepositoryChanged: (listener) => {
                repositoryChanged.add(listener);
                return () => repositoryChanged.delete(listener);
            },
            setWindowVisible: async () => null,
        },
        search: {
            search: async (request) =>
                fixtureSearch(
                    request,
                    list.projects,
                    searchedFiles(shownFolderOf(request.projectId)),
                    searchedNotes(request.projectId),
                ),
            searchContents: async (folderId, query, onFiles) => {
                readableWithoutStarting(folderId);
                const { files, end } = fixtureContentSearch(tree(folderId).files, query, (path) => {
                    const content = fixtureFileContent(path);
                    return content.kind === 'text' ? content.text : null;
                });
                if (files.length > 0) onFiles(files);
                return end;
            },
            stopContentSearch: async () => undefined,
            rankNames: async (query, names) => fixtureRankNames(query, names),
        },
        settings: {
            getSettings: async () => settings,
            // as the backend: a shortcut's settings unchanged change nothing, even refused
            setSettings: async (next) => {
                const fields = { toggle: 'globalShortcut', capture: 'captureShortcut' } as const;
                const other = { toggle: 'capture', capture: 'toggle' } as const;
                for (const action of ['toggle', 'capture'] satisfies ShortcutAction[]) {
                    const { enabled, keys } = next[fields[action]];
                    const current = settings[fields[action]];
                    if (enabled === current.enabled && keys === current.keys) continue;
                    const otherStatus = shortcutStatus[other[action]];
                    const inUse = otherStatus?.kind === 'active' && otherStatus.keys === keys;
                    if (enabled && inUse) throw failure('shortcut_in_use');
                    if (enabled && taken.includes(keys)) throw failure('shortcut_taken');
                    shortcutStatus[action] = enabled
                        ? { kind: 'active', keys, conflict: MACOS_SHORTCUTS.includes(keys) }
                        : { kind: 'off' };
                }
                settings = next;
                return settings;
            },
            getGlobalShortcutStatus: async () => ({ ...shortcutStatus }),
            setShortcutRecording: async () => undefined,
            getVersion: async () => '0.1.0',
            // a browser tab has no file manager to show it in
            revealLog: async () => undefined,
        },
        // a browser tab draws no window controls over the page
        titleBar: { overlaid: false, onOverlaidChange: () => () => undefined },
        // the browser console already shows them
        reportError: () => undefined,
        showWindow: () => undefined,
    };
    return {
        ports,
        openFolder,
        gitInit: (name) => setKind(name, 'repository'),
        gitRemove: (name) => setKind(name, 'plain'),
        writeFile,
        stopDistro: (name) => {
            const shown = shownOf(name);
            const distro = shown ? distroOf(shown.id) : null;
            if (!distro) return;
            running.delete(distro);
            helpers.delete(distro);
        },
    };
}
