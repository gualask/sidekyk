import { lazy, type ReactNode, type RefObject, Suspense, useRef } from 'react';
import { createPortal } from 'react-dom';
import { errorMessage } from '@/shared/errors/app-error';
import { useTranslation } from '@/shared/i18n';
import { shortcutKey } from '@/shared/platform/shortcut';
import { useWindowKeys } from '@/shared/ui/hooks/use-window-keys';
import { isKeyTaken } from '@/shared/ui/keys';
import { errorToast, useShowToast } from '@/shared/ui/toasts';
import { useRepositoryPort } from '../application/repository.port';
import { useMarkdownPreview } from '../application/repository.queries';
import { hasCodeAndPreview, previewKind } from '../model/preview';
import { ImageView } from './ImageView';
import type { PreviewActions, PreviewOpenOn, PreviewPlace } from './MarkdownPreview';
import { Notice } from './Pane';

// the renderer and its blocks load with the first preview, not with the panel
const MarkdownPreview = lazy(() => import('./MarkdownPreview'));

/** What a preview gives the header of the panel it is in. */
export interface PreviewHeader {
    /** The line of the file at the top of the preview, for its code to open on. */
    topLine: () => number | null;
}

/**
 * A file of the project as it reads, in a panel: the header's content (`renderHeader`), then a
 * Markdown file's preview, read again as the file changes, or an image. `⌘F` looks through its
 * code instead (`onFind`, with the line on screen): the preview has no find of its own.
 */
export function PreviewPane({
    projectId,
    path,
    header,
    renderHeader,
    openOn,
    openFile,
    onFind,
}: {
    projectId: string;
    path: string;
    /** The panel's header, where the open file goes (see `PanelProps`). */
    header: HTMLElement | null;
    renderHeader: (preview: PreviewHeader) => ReactNode;
    openOn: PreviewOpenOn | null;
    /** A file of the project a link leads to, at an element of it. */
    openFile: PreviewActions['openFile'];
    /** Not for an image, which has no code. */
    onFind: (line: number | null) => void;
}) {
    const place = useRef<PreviewPlace | null>(null);
    const topLine = () => place.current?.topLine() ?? null;

    useWindowKeys(
        (event) => {
            if (!hasCodeAndPreview(path) || event.defaultPrevented || isKeyTaken(event.target)) {
                return;
            }
            if (shortcutKey(event) !== 'f') return;
            event.preventDefault();
            onFind(topLine());
        },
        { capture: true },
    );

    return (
        <div className="h-full">
            {header ? createPortal(renderHeader({ topLine }), header) : null}
            {previewKind(path) === 'markdown' ? (
                <MarkdownPane
                    projectId={projectId}
                    path={path}
                    openOn={openOn}
                    place={place}
                    openFile={openFile}
                />
            ) : (
                <ImageView projectId={projectId} path={path} />
            )}
        </div>
    );
}

/** A Markdown file's preview, or what it is instead: loading, a failure, not text. */
function MarkdownPane({
    projectId,
    path,
    openOn,
    place,
    openFile,
}: {
    projectId: string;
    path: string;
    openOn: PreviewOpenOn | null;
    place: RefObject<PreviewPlace | null>;
    openFile: PreviewActions['openFile'];
}) {
    const i18n = useTranslation();
    const port = useRepositoryPort();
    const showToast = useShowToast();
    const preview = useMarkdownPreview(projectId, path);
    const actions: PreviewActions = {
        openFile,
        openUrl: (url) => {
            port.openUrl(url).catch((error: unknown) =>
                showToast(errorToast(i18n.t('preview.openFailed', { url }), error, i18n)),
            );
        },
    };

    if (preview.isPending) return <Notice>{i18n.t('view.loadingFile')}</Notice>;
    if (preview.isError) {
        return (
            <Notice>
                <span className="text-ui-danger">{errorMessage(preview.error, i18n)}</span>
            </Notice>
        );
    }
    if (preview.data === null) return <Notice>{i18n.t('preview.none')}</Notice>;
    return (
        <Suspense fallback={null}>
            <MarkdownPreview
                projectId={projectId}
                path={path}
                document={preview.data}
                openOn={openOn}
                place={place}
                actions={actions}
            />
        </Suspense>
    );
}
