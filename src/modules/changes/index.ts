export { type RepositoryPort, RepositoryProvider } from './application/repository.port';
export {
    useMissingRepositories,
    useRepositoryChangeSubscription,
} from './application/repository.queries';
export {
    type ChangedFile,
    type FileDiff,
    REPOSITORY_CHANGED_EVENT,
    type RepositoryChangedEvent,
    type RepositorySnapshot,
    type RepositorySummary,
} from './model/repository.types';
export { changesPanel, changesTarget } from './panel';
export { ChangeCount } from './ui/ChangeCount';
export { ProjectFacts } from './ui/ProjectFacts';
