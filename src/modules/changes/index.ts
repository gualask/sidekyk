export { ChangesSettingsProvider } from './application/changes-settings';
export { type RepositoryPort, RepositoryProvider } from './application/repository.port';
export {
    useMissingRepositories,
    useRepositoryChangeSubscription,
} from './application/repository.queries';
export {
    type ChangedFile,
    type Commit,
    type CommitFileDiffRequest,
    type CommitFiles,
    type CommitRequest,
    type FileChange,
    REPOSITORY_CHANGED_EVENT,
    type RecentCommits,
    type RepositoryChangedEvent,
    type RepositorySnapshot,
    type RepositorySummary,
    type UnifiedDiff,
} from './model/repository.types';
export { changesPanel, changesTarget } from './panel';
export { ChangeCount } from './ui/ChangeCount';
export { ProjectFacts } from './ui/ProjectFacts';
