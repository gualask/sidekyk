import type { FileView } from '@/shared/git/file-view';
import { useTranslation } from '@/shared/i18n';
import { keysLabel } from '@/shared/platform/keys';
import type { FileFinder } from '../../application/find';
import { FileHeader } from '../viewer/FileHeader';
import { TextFileView } from '../viewer/text/TextFileView';
import type { ShowInFiles } from './ChangedFileView';

/** A file of the tree that did not change, as its text, its header saying so. */
export function UnchangedFileView({
    folderId,
    path,
    header,
    finder,
    view,
    onView,
    anchor,
    openFile,
    showInFiles,
}: {
    folderId: string;
    path: string;
    /** The panel's header, where the open file goes (see `PanelProps`). */
    header: HTMLElement | null;
    finder: FileFinder;
    /** How a file with a preview shows, for the panel's files while it is open. */
    view: FileView;
    onView: (view: FileView) => void;
    /** An element of the file for its preview to open on: a link's. */
    anchor: string | null;
    openFile: (path: string, anchor: string | null) => void;
    showInFiles: ShowInFiles;
}) {
    const i18n = useTranslation();
    return (
        <TextFileView
            key={path}
            folderId={folderId}
            path={path}
            header={header}
            finder={finder}
            view={view}
            onView={onView}
            anchor={anchor}
            openFile={openFile}
            renderHeader={({ uncolored, view: shown }) => (
                <FileHeader
                    path={path}
                    uncolored={uncolored}
                    badge={{
                        label: i18n.t('changes.unchanged'),
                        title: i18n.t('changes.unchangedTitle', { esc: keysLabel('Escape') }),
                    }}
                    view={shown}
                    showIn={showInFiles(path, () => null)}
                />
            )}
        />
    );
}
