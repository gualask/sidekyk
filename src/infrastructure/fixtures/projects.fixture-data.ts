import type { FolderChoice, ProjectList } from '@/modules/projects';
import type { ProjectInfo, ProjectLocation } from '@/shared/projects/project-info';
import { localProject, wslProject } from './projects.fixture';
import { FIXTURE_REPOSITORY } from './review.fixture-data';
import type { Scenario } from './scenario';

/** Projects with a clean working tree, next to the scenario's own. */
export const CLEAN_PROJECTS: ProjectInfo[] = [
    localProject('/Users/dev/Projects/docs-site', 'docs-site', 2),
    localProject('/Users/dev/Projects/api-gateway', 'api-gateway', 6),
];

/** In `review`: a clone of the scenario's repository in a WSL distro, clean, of the same name. */
const WSL_PROJECT = wslProject('Ubuntu', '/home/dev/shop', 'shop', 3);

/** In `review` and `clean`: a project without folder, notes on a topic. */
export const TOPIC_PROJECT: ProjectInfo = {
    id: 'b0000000000000a1',
    name: 'Thesis',
    folders: [],
    avatar: { color: 5, letters: null },
};

/** In `review` and `clean`: a folder without git, notes in Markdown (`sidekykDev.gitInit`). */
const VAULT_ROOT = '/Users/dev/Notes/vault';
const VAULT_PROJECT = localProject(VAULT_ROOT, 'Vault', 4);

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
export function pickedParent(list: ProjectList): FolderChoice {
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
export function pickedLocation(path: string): ProjectLocation | null {
    const picked = [PICKED_REPOSITORY, PICKED_PLAIN].find((p) => p.path === path);
    if (picked) return picked.location;
    const inside = INSIDE_PARENT.some((name) => path === `${PARENT_ROOT}/${name}`);
    return inside || path === PARENT_ROOT ? { kind: 'local', root: path } : null;
}

/** The folders without git, until `sidekykDev.gitInit`: they list notes in Markdown. */
export const DOCUMENT_ROOTS: readonly string[] = [
    VAULT_ROOT,
    PICKED_PLAIN.location.root,
    PARENT_ROOT,
];

/**
 * What the folder picker gives in turn, to see each answer of the New project dialog: a parent of
 * repositories, a repository no project follows, the scenario's own repository, then a folder
 * without git.
 */
export const PICKED_FOLDERS: readonly ((list: ProjectList) => FolderChoice)[] = [
    pickedParent,
    () => PICKED_REPOSITORY,
    (list) =>
        list.projects.some((p) => p.id === FIXTURE_REPOSITORY.id)
            ? { kind: 'inProject', id: FIXTURE_REPOSITORY.id, name: FIXTURE_REPOSITORY.name }
            : PICKED_PLAIN,
    () => PICKED_PLAIN,
];

/** What the folder picker gives in turn to add a folder to a project. */
export const ADDED_FOLDERS: readonly { location: ProjectLocation }[] = [
    PICKED_REPOSITORY,
    { location: { kind: 'local', root: CLEAN_PROJECTS[0].folders[0].root } },
    { location: { kind: 'local', root: PARENT_ROOT } },
];

/** In `problems`: a project whose repository was moved or deleted after it was added. */
export const MISSING_PROJECT = localProject(
    '/Users/dev/Projects/old-prototype',
    'old-prototype',
    2,
);

/**
 * In `problems`, WSL projects: a distro that does not run (until the project opens), one gone, one
 * without git.
 */
const STOPPED_PROJECT = wslProject('Debian', '/home/dev/api', 'api', 3);
export const GONE_PROJECT = wslProject('Arch', '/home/dev/dotfiles', 'dotfiles', 4);
export const NO_GIT_PROJECT = wslProject('Alpine', '/home/dev/tools', 'tools', 5);

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

/** The projects a scenario starts with. */
export function initialProjects(scenario: Scenario): ProjectInfo[] {
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
