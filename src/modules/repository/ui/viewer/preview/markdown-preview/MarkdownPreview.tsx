import { useVirtualizer, type VirtualItem } from '@tanstack/react-virtual';
import { type RefObject, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { useTranslation } from '@/shared/i18n';
import { useRepositorySettings } from '../../../../application/repository-settings';
import {
    blockAtLine,
    blocksById,
    diagramBlocks,
    kindKeys,
} from '../../../../model/preview/preview';
import type { MarkdownBlock, MarkdownDocument } from '../../../../model/repository.types';
import { DiagramView } from '../diagram/DiagramView';
import { Block } from './blocks/Blocks';
import { type DiagramBlockOf, PreviewContext, type PreviewContextValue } from './preview-context';

/** Where a preview is read: its first line on screen, for the code to open on. */
export interface PreviewPlace {
    topLine: () => number | null;
}

/** Where a preview opens: on a line of the file, else on an element of it. */
export interface PreviewOpenOn {
    line: number | null;
    anchor: string | null;
}

/** What the preview's links do outside it. */
export interface PreviewActions {
    /** A file of the project's tree, at an element of it if `anchor`. */
    openFile: (path: string, anchor: string | null) => void;
    /** `http`, `https`, `mailto`: in the system's browser or mail app. */
    openUrl: (url: string) => void;
}

const PADDING = { start: 28, end: 64 };

/** A first guess of a block's height, before it is measured. */
function estimate(block: MarkdownBlock): number {
    switch (block.kind) {
        case 'code':
            return 40 + block.lines.length * 20;
        case 'diagram':
            return 240;
        case 'list':
            return 12 + block.items.length * 26;
        case 'table':
            return 40 + block.rows.length * 34;
        case 'heading':
            return 52;
        case 'rule':
            return 34;
        default:
            return 64;
    }
}

/**
 * A Markdown file as it reads, from the backend's tree: only the blocks on screen render, each
 * measured as it shows. Links lead to the document's headings, to the project's files and to the
 * browser; code blocks take the file's own syntax colors. Nothing in the file runs: every element
 * is one of ours, its text escaped by React.
 */
export default function MarkdownPreview({
    folderId,
    path,
    document,
    openOn,
    place,
    actions,
}: {
    folderId: string;
    path: string;
    document: MarkdownDocument;
    openOn: PreviewOpenOn | null;
    place: RefObject<PreviewPlace | null>;
    actions: PreviewActions;
}) {
    const i18n = useTranslation();
    const { codeLines } = useRepositorySettings();
    const { blocks } = document;
    const keys = useMemo(() => kindKeys(blocks), [blocks]);
    const ids = useMemo(() => blocksById(blocks), [blocks]);
    const scroll = useRef<HTMLDivElement>(null);
    const [opening] = useState(() => openingOf(openOn, blocks, ids));
    const virtualizer = useVirtualizer({
        count: blocks.length,
        getScrollElement: () => scroll.current,
        estimateSize: (index) => estimate(blocks[index]),
        getItemKey: (index) => keys[index],
        paddingStart: PADDING.start,
        paddingEnd: PADDING.end,
        overscan: 4,
        // read once, when the list first shows: the file read again keeps the scroll
        initialOffset: () => (opening.block === null ? 0 : offsetOf(blocks, opening.block)),
    });
    const seek = useSoughtElement(scroll, opening.anchor);
    const goTo = (id: string) => {
        const index = ids.get(id);
        if (index === undefined) return;
        virtualizer.scrollToIndex(index, { align: 'start' });
        seek(id);
    };

    useImperativeHandle(place, () => ({
        topLine: () =>
            topLineOf(blocks, virtualizer.scrollOffset ?? 0, virtualizer.getVirtualItems()),
    }));

    const { zoomedSource, openDiagram, closeZoom } = useZoomedDiagram(blocks);

    // every block on screen renders again with the list anyway: nothing to keep from one to the next
    const context: PreviewContextValue = {
        folderId,
        path,
        actions,
        goTo,
        wrap: codeLines === 'wrap',
        openDiagram,
    };

    return (
        <PreviewContext.Provider value={context}>
            <div className="relative h-full">
                <div
                    ref={scroll}
                    className="h-full overflow-y-auto bg-ui-surface-subtle [overflow-anchor:none]"
                >
                    <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
                        {virtualizer.getVirtualItems().map((item) => (
                            <div
                                key={item.key}
                                ref={virtualizer.measureElement}
                                data-index={item.index}
                                className="absolute top-0 left-0 w-full px-8"
                                style={{ transform: `translateY(${item.start}px)` }}
                            >
                                <div className="mx-auto max-w-[860px] pb-4 text-[14.5px] leading-[1.65] text-ui-text">
                                    <Block block={blocks[item.index]} />
                                </div>
                            </div>
                        ))}
                    </div>
                    {document.truncated ? (
                        <p className="pb-16 text-center text-sm text-ui-text-muted">
                            {i18n.t('view.fileCut')}
                        </p>
                    ) : null}
                </div>
                {zoomedSource === null ? null : (
                    <div className="absolute inset-0 z-10">
                        <DiagramView source={zoomedSource} onClose={closeZoom} />
                    </div>
                )}
            </div>
        </PreviewContext.Provider>
    );
}

/**
 * Where it opens: the block of the line the code was read at, else of the element a link named,
 * its place first guessed, then the element itself once it shows.
 */
function openingOf(
    openOn: PreviewOpenOn | null,
    blocks: readonly MarkdownBlock[],
    ids: ReadonlyMap<string, number>,
): { block: number | null; anchor: string | null } {
    if (openOn?.line) return { block: blockAtLine(blocks, openOn.line), anchor: null };
    const anchor = openOn?.anchor ?? null;
    return { block: anchor === null ? null : (ids.get(anchor) ?? null), anchor };
}

/** Where a block starts before any is measured: the guessed heights of those above it. */
function offsetOf(blocks: readonly MarkdownBlock[], index: number): number {
    return blocks
        .slice(0, index)
        .reduce((offset, block) => offset + estimate(block), PADDING.start);
}

/** The line of the first block on screen, `top` being the scroll; none for the footnotes. */
function topLineOf(
    blocks: readonly MarkdownBlock[],
    top: number,
    items: readonly VirtualItem[],
): number | null {
    const first = items.find((item) => item.end > top + PADDING.start);
    const block = first ? blocks[first.index] : blocks[0];
    return block && block.kind !== 'footnotes' ? block.line : null;
}

/**
 * An element asked for (`initial` as the preview opens), scrolled to once the block holding it
 * has rendered; returns how to ask for one.
 */
function useSoughtElement(scroll: RefObject<HTMLElement | null>, initial: string | null) {
    const [sought, setSought] = useState<string | null>(initial);
    useEffect(() => {
        if (!sought) return;
        const frame = requestAnimationFrame(() => {
            scroll.current
                ?.querySelector(`[id="${CSS.escape(sought)}"]`)
                ?.scrollIntoView({ block: 'start' });
            setSought(null);
        });
        return () => cancelAnimationFrame(frame);
    }, [scroll, sought]);
    return setSought;
}

/**
 * The diagram open over the preview, by its place among the file's diagrams, so it is drawn from
 * the document as the file changes; and what had the focus, which gets it back after.
 */
function useZoomedDiagram(blocks: readonly MarkdownBlock[]) {
    const diagrams = useMemo(() => diagramBlocks(blocks), [blocks]);
    const [zoomed, setZoomed] = useState<number | null>(null);
    const focusBack = useRef<HTMLElement | null>(null);
    const zoomedSource = zoomed === null ? null : (diagrams[zoomed]?.source ?? null);
    // the file no longer has it: closed
    if (zoomed !== null && zoomedSource === null) setZoomed(null);
    const openDiagram = (block: DiagramBlockOf) => {
        const place = diagrams.indexOf(block);
        if (place < 0) return;
        if (window.document.activeElement instanceof HTMLElement) {
            focusBack.current = window.document.activeElement;
        }
        setZoomed(place);
    };
    const closeZoom = () => {
        setZoomed(null);
        focusBack.current?.focus();
        focusBack.current = null;
    };
    return { zoomedSource, openDiagram, closeZoom };
}
