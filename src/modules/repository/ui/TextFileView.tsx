import { IconFileOff, IconFolder, IconLink } from '@tabler/icons-react';
import { type ReactNode, useMemo } from 'react';
import { errorMessage } from '@/shared/errors/app-error';
import { RichText, useTranslation } from '@/shared/i18n';
import type { FileFinder } from '../application/find';
import { useFileContent } from '../application/repository.queries';
import { textLines, textRows } from '../model/diff-rows';
import { fileSides } from '../model/syntax';
import { Notice, Pane, type PaneHeader } from './Pane';

const NO_HUNKS: [] = [];

/**
 * A file that did not change: its text on the viewer's rows, which copy a line, or a selection,
 * with a click as they do in a diff. A link shows where it points, never followed.
 */
export function TextFileView({
    projectId,
    path,
    header,
    renderHeader,
    finder,
}: {
    projectId: string;
    path: string;
    /** The panel's header, where the open file goes (see `PanelProps`). */
    header: HTMLElement | null;
    renderHeader: (pane: PaneHeader) => ReactNode;
    /** What the file is looked through with. */
    finder: FileFinder;
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
