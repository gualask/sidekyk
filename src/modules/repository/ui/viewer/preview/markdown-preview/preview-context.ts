import { createContext, useContext } from 'react';
import type { MarkdownBlock } from '../../../../model/repository.types';
import type { PreviewActions } from './MarkdownPreview';

export type DiagramBlockOf = Extract<MarkdownBlock, { kind: 'diagram' }>;

/** What every block of a document needs, without passing it down each level. */
export interface PreviewContextValue {
    folderId: string;
    path: string;
    actions: PreviewActions;
    goTo: (id: string) => void;
    wrap: boolean;
    /** Opens a diagram over the preview. */
    openDiagram: (block: DiagramBlockOf) => void;
}

export const PreviewContext = createContext<PreviewContextValue | null>(null);

/** Inside a link: an image there shows, its click being the link's. */
export const InLink = createContext(false);

export function usePreview(): PreviewContextValue {
    const context = useContext(PreviewContext);
    if (!context) throw new Error('usePreview must be used within a MarkdownPreview');
    return context;
}
