import { IconFileOff, IconFolder, IconLink } from '@tabler/icons-react';
import { type ReactNode, useMemo } from 'react';
import { errorMessage } from '@/shared/errors/app-error';
import { useFileContent } from '../application/repository.queries';
import { textLines, textRows } from '../model/diff-rows';
import { Notice, Pane, type PaneHeader } from './Pane';

const NO_HUNKS: [] = [];

/**
 * A file that did not change: its text on the viewer's rows, which copy a line, or a selection,
 * with a click as they do in a diff. A link shows where it points, never followed.
 */
export function TextFileView({
    root,
    path,
    header,
    renderHeader,
}: {
    root: string;
    path: string;
    /** The panel's header, where the open file goes (see `PanelProps`). */
    header: HTMLElement | null;
    renderHeader: (pane: PaneHeader) => ReactNode;
}) {
    const content = useFileContent(root, path);
    const data = content.data;
    const text = data?.kind === 'text' ? data : null;
    const { rows, widest } = useMemo(() => textRows(textLines(text?.text ?? '')), [text]);
    const source = useMemo(() => ({ path, origPath: null, commit: null }), [path]);

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
        >
            {content.isPending ? <Notice>Loading file…</Notice> : null}
            {content.isError ? (
                <Notice>
                    <span className="text-ui-danger">{errorMessage(content.error)}</span>
                </Notice>
            ) : null}
            {text && rows.length === 0 ? <Notice>The file is empty.</Notice> : null}
            {text?.truncated ? (
                <Notice>The file is too large to show whole: it was cut here.</Notice>
            ) : null}
            {data?.kind === 'binary' ? (
                <Notice>
                    <IconFileOff size={28} stroke={1.5} />
                    Binary file, no text to show.
                </Notice>
            ) : null}
            {data?.kind === 'link' ? (
                <Notice>
                    <IconLink size={28} stroke={1.5} />
                    <span>
                        A link to <span className="font-mono">{data.target}</span>
                    </span>
                </Notice>
            ) : null}
            {data?.kind === 'folder' ? (
                <Notice>
                    <IconFolder size={28} stroke={1.5} />A repository of its own (a submodule).
                </Notice>
            ) : null}
        </Pane>
    );
}
