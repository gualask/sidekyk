import type { ChangedFile, FolderKind } from '@/modules/repository';
import { projectFolder } from '@/shared/projects/project-info';
import { fixtureFolderTree, fixtureTree } from './files.fixture-data';
import { REPOSITORY_IMAGES, VAULT_IMAGES } from './fixture-files';
import { largeSnapshot } from './large.fixture-data';
import type { FixtureProjects } from './projects';
import {
    DOCUMENT_ROOTS,
    GONE_PROJECT,
    MISSING_PROJECT,
    NO_GIT_PROJECT,
} from './projects.fixture-data';
import { reviewSnapshot } from './review.fixture-data';
import { failure, hasScenarioData, isLarge, type Scenario } from './scenario';

/** How long Sidekyk's helper takes to start in a distro, as the first read of a WSL project waits. */
const HELPER_START_MS = 1500;

type FixtureTree = ReturnType<typeof fixtureTree>;

/** What the search reads of a folder, as the backend's palette and content search do. */
export interface FixtureFolders {
    /** `distro_stopped` unless the folder's distro runs, as `readable_without_starting`. */
    readableWithoutStarting: (folderId: string) => void;
    tree: (folderId: string) => FixtureTree;
    /**
     * The files of the tree the palette searches, as the last snapshot found them changed: none
     * when they cannot be read.
     */
    searched: (
        folderId: string | null,
    ) => { paths: readonly string[]; changed: readonly ChangedFile[] } | null;
}

/**
 * The projects' folders as they are on disk and in WSL: there or gone, with git or without, their
 * distro running or not and Sidekyk's helper started in it, and what git and a walk find in them.
 * Each check throws the backend's failure.
 */
export function fixtureFolders(scenario: Scenario, projects: FixtureProjects) {
    const { folder } = projects;
    const scenarioData = (folderId: string) => hasScenarioData(scenario, folderId);
    const large = (folderId: string) => isLarge(scenario, folderId);
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
    const snapshot = (folderId: string) => {
        readable(folderId);
        if (large(folderId)) return largeSnapshot();
        return reviewSnapshot(!scenarioData(folderId));
    };

    // as the backend, the tree is built once and kept: the fixtures never change on disk
    const trees = new Map<string, FixtureTree>();
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

    return {
        /** The folder holds the scenario's data (`hasScenarioData`). */
        scenarioData,
        /** The folder holds the `large` scenario's data. */
        large,
        kindOf,
        present,
        readable,
        readableWithoutStarting,
        startHelper,
        snapshot,
        tree,
        searched: (folderId: string | null) => {
            if (!folderId) return null;
            try {
                readableWithoutStarting(folderId);
                const changed = kindOf(folderId) === 'plain' ? [] : snapshot(folderId).files;
                return { paths: tree(folderId).files, changed };
            } catch {
                return null;
            }
        },
        /** A folder without git holds the Vault's images, the repository its own. */
        imagesOf: (folderId: string) =>
            DOCUMENT_ROOTS.includes(rootOf(folderId)) ? VAULT_IMAGES : REPOSITORY_IMAGES,
        /** As `git init` (`repository`) or `.git` removed (`plain`) at the folder's root. */
        setKind: (folderId: string, kind: FolderKind) => {
            if (kind === 'plain') plainRoots.add(rootOf(folderId));
            else plainRoots.delete(rootOf(folderId));
        },
        /** As `wsl --shutdown` of the folder's distro: its helper starts again with it. */
        stopDistro: (folderId: string) => {
            const distro = distroOf(folderId);
            if (!distro) return;
            running.delete(distro);
            helpers.delete(distro);
        },
    };
}
