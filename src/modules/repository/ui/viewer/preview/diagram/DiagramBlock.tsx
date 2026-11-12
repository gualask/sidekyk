import type { ReactNode } from 'react';
import { errorMessage } from '@/shared/errors/app-error';
import { useTranslation } from '@/shared/i18n';
import { useShownDiagram } from '../../../../application/queries/file-reads';
import { useDiagramColors } from '../diagram-colors';
import { DiagramImage, InvalidLine } from './DiagramImage';

/**
 * A Markdown file's ` ```mermaid ` block: the diagram in place of its code, at its own size or
 * narrower to fit the text's column, centered; a click opens it over the preview, to zoom. A
 * source that never read shows as code (`code`), with why.
 */
export function DiagramBlock({
    source,
    code,
    onOpen,
}: {
    source: string;
    code: ReactNode;
    onOpen: () => void;
}) {
    const i18n = useTranslation();
    const shown = useShownDiagram(source, useDiagramColors());
    if (shown.error) {
        return (
            <>
                {code}
                <p className="mt-1 text-xs text-ui-danger">{errorMessage(shown.error, i18n)}</p>
            </>
        );
    }
    if (shown.drawn === null && shown.invalid) {
        return (
            <>
                {code}
                <div className="mt-1">
                    <InvalidLine invalid={shown.invalid} />
                </div>
            </>
        );
    }
    // drawn within milliseconds: room kept, nothing said
    if (shown.drawn === null) return <div className="min-h-24" aria-busy="true" />;
    return (
        <figure className="flex flex-col items-center gap-2">
            <button
                type="button"
                className="max-w-full cursor-zoom-in rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-accent-muted"
                title={i18n.t('preview.diagramOpen')}
                onClick={onOpen}
            >
                <DiagramImage diagram={shown.drawn} className="block h-auto max-w-full" />
            </button>
            {shown.invalid ? <InvalidLine invalid={shown.invalid} /> : null}
        </figure>
    );
}
