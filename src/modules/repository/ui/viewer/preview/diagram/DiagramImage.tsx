import { type CSSProperties, useMemo } from 'react';
import { useTranslation } from '@/shared/i18n';
import { diagramUrl } from '../../../../model/preview/diagram';
import type { Diagram } from '../../../../model/repository.types';

export type DrawnDiagram = Extract<Diagram, { kind: 'drawn' }>;
type InvalidDiagram = Extract<Diagram, { kind: 'invalid' }>;

/** A drawn diagram as an image, at its own size unless `className` says otherwise. */
export function DiagramImage({
    diagram,
    className,
    style,
}: {
    diagram: DrawnDiagram;
    className?: string;
    style?: CSSProperties;
}) {
    const i18n = useTranslation();
    const url = useMemo(() => diagramUrl(diagram.svg), [diagram.svg]);
    return (
        <img
            src={url}
            width={diagram.width}
            height={diagram.height}
            alt={i18n.t('preview.diagram')}
            draggable={false}
            className={className}
            style={style}
        />
    );
}

/** Why a source does not read, in Mermaid's words. */
export function InvalidLine({ invalid }: { invalid: InvalidDiagram }) {
    const i18n = useTranslation();
    return (
        <p className="text-xs text-ui-danger">
            {invalid.detail === null
                ? i18n.t('preview.diagramNone')
                : i18n.t('preview.diagramInvalid', { detail: invalid.detail })}
        </p>
    );
}
