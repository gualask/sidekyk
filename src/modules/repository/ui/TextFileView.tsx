import { IconFileOff, IconFolder, IconLink } from '@tabler/icons-react';
import { type ReactNode, useMemo, useState } from 'react';
import { errorMessage } from '@/shared/errors/app-error';
import type { FileView } from '@/shared/git/file-view';
import { RichText, useTranslation } from '@/shared/i18n';
import type { FileFinder } from '../application/find';
import { useFileContent } from '../application/repository.queries';
import { textLines, textRows } from '../model/diff-rows';
import { hasCodeAndPreview, previewKind } from '../model/preview';
import { fileSides } from '../model/syntax';
import type { PreviewActions } from './MarkdownPreview';
import { Notice, Pane, type PaneHeader } from './Pane';
import { PreviewPane } from './PreviewPane';
import { FILE_VIEWS, type ViewSwitch } from './view-options';

const NO_HUNKS: [] = [];

/**
 * A file that did not change: its text on the viewer's rows, which copy a line, or a selection,
 * with a click as they do in a diff. A link shows where it points, never followed. A Markdown
 * or SVG file shows as it reads too, "Code | Preview" in the header: a switch opens the other on
 * the line that was at the top. An image shows as it is, having no text.
 */
export function TextFileView({
    projectId,
    path,
    header,
    renderHeader,
    finder,
    view,
    onView,
    anchor = null,
    openFile,
}: {
    projectId: string;
    path: string;
    /** The panel's header, where the open file goes (see `PanelProps`). */
    header: HTMLElement | null;
    /**
     * The header's content: whether the file is too large to color, and the switch between code
     * and preview when it has both.
     */
    renderHeader: (shown: { uncolored: boolean; view: ViewSwitch | null }) => ReactNode;
    /** What the file is looked through with. */
    finder: FileFinder;
    /** How a file with a preview shows, as the panel chose; the switch changes it. */
    view: FileView;
    onView: (view: FileView) => void;
    /** An element of the file for its preview to open on: a link's. */
    anchor?: string | null;
    /** A file of the project a link of the preview leads to. */
    openFile: PreviewActions['openFile'];
}) {
    const kind = previewKind(path);
    const previewed = kind === 'image' || (hasCodeAndPreview(path) && view === 'preview');
    // the line to open the other view on, after a switch
    const [line, setLine] = useState<number | null>(null);
    const switchTo = (next: FileView, at: number | null) => {
        setLine(at);
        onView(next);
    };
    const viewSwitch = (topLine: () => number | null): ViewSwitch<FileView> | null =>
        hasCodeAndPreview(path)
            ? { value: view, options: FILE_VIEWS, onChange: (next) => switchTo(next, topLine()) }
            : null;

    if (previewed) {
        return (
            <PreviewPane
                projectId={projectId}
                path={path}
                header={header}
                renderHeader={({ topLine }) =>
                    renderHeader({ uncolored: false, view: viewSwitch(topLine) })
                }
                openOn={{ line, anchor }}
                openFile={openFile}
                onFind={(at) => {
                    switchTo('code', at);
                    finder.open(at);
                }}
            />
        );
    }
    return (
        <CodeView
            projectId={projectId}
            path={path}
            header={header}
            renderHeader={(pane) =>
                renderHeader({ uncolored: pane.uncolored, view: viewSwitch(pane.topLine) })
            }
            finder={finder}
            openOnLine={line}
        />
    );
}

/** The file's text on the viewer's rows, or what it is instead. */
function CodeView({
    projectId,
    path,
    header,
    renderHeader,
    finder,
    openOnLine,
}: {
    projectId: string;
    path: string;
    header: HTMLElement | null;
    renderHeader: (pane: PaneHeader) => ReactNode;
    finder: FileFinder;
    openOnLine: number | null;
}) {
    const i18n = useTranslation();
    const content = useFileContent(projectId, path);
    const data = content.data;
    const text = data?.kind === 'text' ? data : null;
    const { rows, widest } = useMemo(() => textRows(textLines(text?.text ?? '')), [text]);
    const source = useMemo(() => ({ path, origPath: null, commit: null }), [path]);
    const syntax = useMemo(() => ({ projectId, sides: fileSides(path) }), [projectId, path]);

    return (
        <Pane
            header={header}
            renderHeader={renderHeader}
            source={source}
            rows={rows}
            hunks={NO_HUNKS}
            widest={widest}
            openOn={null}
            openOnLine={openOnLine}
            linesAbove={0}
            finder={finder}
            syntax={syntax}
        >
            {content.isPending ? <Notice>{i18n.t('view.loadingFile')}</Notice> : null}
            {content.isError ? (
                <Notice>
                    <span className="text-ui-danger">{errorMessage(content.error, i18n)}</span>
                </Notice>
            ) : null}
            {text && rows.length === 0 ? <Notice>{i18n.t('view.empty')}</Notice> : null}
            {text?.truncated ? <Notice>{i18n.t('view.fileCut')}</Notice> : null}
            {data?.kind === 'binary' ? (
                <Notice>
                    <IconFileOff size={28} stroke={1.5} />
                    {i18n.t('view.binary')}
                </Notice>
            ) : null}
            {data?.kind === 'link' ? (
                <Notice>
                    <IconLink size={28} stroke={1.5} />
                    <span>
                        <RichText
                            text={i18n.t('view.link')}
                            parts={{ target: <span className="font-mono">{data.target}</span> }}
                        />
                    </span>
                </Notice>
            ) : null}
            {data?.kind === 'folder' ? (
                <Notice>
                    <IconFolder size={28} stroke={1.5} />
                    {i18n.t('view.submodule')}
                </Notice>
            ) : null}
        </Pane>
    );
}
