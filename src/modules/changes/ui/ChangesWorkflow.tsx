import { errorMessage } from '@/shared/errors/app-error';
import {
    useActiveRepository,
    useRepositoryChangeSubscription,
} from '../application/repository.queries';
import { ChangesWorkspace } from './ChangesWorkspace';
import { NoRepository } from './NoRepository';

/** The Changes panel: the open repository's changes, or the screen that opens one. */
export function ChangesWorkflow() {
    useRepositoryChangeSubscription();
    const active = useActiveRepository();

    if (active.isPending) return null;
    if (active.isError) {
        return (
            <div className="flex h-full items-center justify-center p-8 text-sm text-ui-danger">
                {errorMessage(active.error)}
            </div>
        );
    }
    if (!active.data) return <NoRepository />;

    return <ChangesWorkspace key={active.data.root} repository={active.data} />;
}
