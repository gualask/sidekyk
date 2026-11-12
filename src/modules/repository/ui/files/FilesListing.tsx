import { errorMessage } from '@/shared/errors/app-error';
import type { ChangeMark } from '@/shared/git/change-mark';
import { useTranslation } from '@/shared/i18n';
import type { FilesView } from './FilesActions';
import { FileTree } from './FileTree';
import { RecentList } from './RecentList';
import type { FileTreeState } from './use-file-tree';
import type { RecentListState } from './use-recent-list';

/**
 * The files listed in the view shown, the tree or Recent, under what their read has to say: a
 * failure, or Recent without a file. A folder clicked opens or closes; a file is picked
 * (`onPick`).
 */
export function FilesListing({
    view,
    error,
    tree,
    recent,
    marks,
    label,
    onPick,
}: {
    view: FilesView;
    /** The view's read that failed, if it did. */
    error: unknown;
    tree: FileTreeState;
    recent: RecentListState;
    marks: ReadonlyMap<string, ChangeMark>;
    label: string;
    onPick: (path: string) => void;
}) {
    const i18n = useTranslation();
    return (
        <div className="flex h-full flex-col">
            {error ? (
                <div className="px-3 py-2 font-sans text-sm text-ui-danger">
                    {errorMessage(error, i18n)}
                </div>
            ) : null}
            {view === 'recent' && recent.empty ? (
                <div className="px-3 py-2 font-sans text-sm text-ui-text-muted">
                    {i18n.t('files.recent.empty')}
                </div>
            ) : null}
            <div className="min-h-0 flex-1">
                {view === 'tree' ? (
                    <FileTree
                        rows={tree.rows}
                        marks={marks}
                        selected={tree.selected}
                        label={label}
                        onClick={(row) => {
                            if (row.kind === 'folder') tree.toggle(row.path);
                            else onPick(row.path);
                        }}
                    />
                ) : (
                    <RecentList
                        rows={recent.listed.rows}
                        formats={recent.listed.formats}
                        marks={marks}
                        selected={recent.selected}
                        label={label}
                        onClick={onPick}
                    />
                )}
            </div>
        </div>
    );
}

/** Across the panel, above the files, while their read was cut: too many to list. */
export function TooManyFiles() {
    const i18n = useTranslation();
    return (
        <div className="border-b border-ui-border bg-ui-warning-soft px-3 py-2 text-sm text-ui-warning-soft-text">
            {i18n.t('files.tooMany')}
        </div>
    );
}
