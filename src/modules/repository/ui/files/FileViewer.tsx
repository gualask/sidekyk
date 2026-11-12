import { IconFileText } from '@tabler/icons-react';
import { useTranslation } from '@/shared/i18n';
import type { PanelProps } from '@/shared/panels/panel';
import type { FileFinder } from '../../application/find';
import type { SnapshotRead } from '../../application/queries/formatting-check';
import { useFileViewChoice, useLinkedAnchor } from '../../application/view-choice';
import { CHANGE_AREA_LABEL } from '../../model/change-area';
import type { ChangedFile } from '../../model/repository.types';
import { type FileLines, fileTarget } from '../../model/targets';
import { ChangeDiffView } from '../viewer/diff/DiffView';
import { LINES_ABOVE } from '../viewer/diff/diff-layout';
import { FileHeader } from '../viewer/FileHeader';
import { TextFileView } from '../viewer/text/TextFileView';

/** The line the viewer opens on for some lines: a few above them, as a change opens. */
function openingLine({ first }: FileLines): number {
    return Math.max(1, first - LINES_ABOVE);
}

/**
 * The file shown beside the tree full screen: the change shown, a deleted file too though the
 * tree does not have it, whole with its changes marked; else the file, as its text; else a word
 * to pick one. It opens on the lines marked, again each time they are asked for (`linesAsked`).
 */
export function FileViewer({
    folderId,
    repository,
    snapshot,
    change,
    file,
    marked,
    linesAsked,
    openOn,
    header,
    finderFor,
    show,
    openFile,
}: {
    folderId: string;
    repository: boolean;
    snapshot: SnapshotRead & { isSuccess: boolean };
    change: ChangedFile | null;
    file: string | null;
    marked: FileLines | null;
    linesAsked: number;
    /** The hunk a file asked for from Changes opens on, until another file shows. */
    openOn: { file: string; hunk: number } | null;
    header: HTMLElement | null;
    finderFor: (path: string) => FileFinder;
    show: PanelProps['show'];
    openFile: (path: string) => void;
}) {
    const i18n = useTranslation();
    // how a file with a preview shows, and the element a link of one named in the file it leads to
    const fileView = useFileViewChoice();
    const linked = useLinkedAnchor(file);
    const lineShown = marked ? openingLine(marked) : null;
    const opening = marked ? linesAsked : '';
    if (change) {
        return (
            <ChangeDiffView
                key={`${change.area}:${change.path}:${opening}`}
                folderId={folderId}
                file={change}
                snapshot={snapshot}
                view="file"
                openOn={openOn?.file === change.path ? openOn.hunk : null}
                openOnLine={lineShown}
                marked={marked}
                header={header}
                finder={finderFor(change.path)}
                renderHeader={(pane) => (
                    <FileHeader
                        path={change.path}
                        uncolored={pane.uncolored}
                        badge={{ label: i18n.t(CHANGE_AREA_LABEL[change.area]) }}
                        counts={change}
                        showIn={{
                            panel: 'changes',
                            onShow: () =>
                                show('changes', fileTarget(change.path, pane.currentHunk())),
                        }}
                    />
                )}
            />
        );
    }
    if (!file) {
        return (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-ui-text-muted">
                <IconFileText size={32} stroke={1.5} />
                <p className="text-sm">{i18n.t('files.pick')}</p>
                <p className="text-xs">{i18n.t('files.readOnly')}</p>
            </div>
        );
    }
    if (repository && !snapshot.isSuccess) return null;
    return (
        <TextFileView
            key={`${file}:${opening}`}
            folderId={folderId}
            path={file}
            header={header}
            finder={finderFor(file)}
            view={fileView.view}
            onView={fileView.choose}
            anchor={linked.anchorFor(file)}
            openOnLine={lineShown}
            marked={marked}
            openFile={(path, anchor) => {
                openFile(path);
                linked.link(path, anchor);
            }}
            renderHeader={({ uncolored, view }) => (
                <FileHeader path={file} uncolored={uncolored} view={view} />
            )}
        />
    );
}
