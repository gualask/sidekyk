import { type RefObject, useState } from 'react';
import { type Translator, useTranslation } from '@/shared/i18n';
import { useCopyToClipboard } from '@/shared/ui/hooks/use-copy-to-clipboard';
import { useRepositorySettings } from '../../../../application/repository-settings';
import {
    type Copied,
    type CopySource,
    copiedLabel,
    copiedText,
    hunkCopied,
    lineCopied,
    selectionCopied,
} from '../../../../model/diff/copied';
import type { DiffHunk, DiffLine } from '../../../../model/diff/diff-parser';
import type { DiffRow } from '../../../../model/diff/diff-rows';
import type { DiffLayout, Span } from '../diff-layout';
import { type Target, targetSpan } from '../diff-target';
import { useDiffPointer } from '../use-diff-pointer';

/** A copy's confirmation: its rows, what it says, and how far the list runs right of the screen. */
export type Flash = Span & { label: string; right: number; key: number };

/**
 * The copies of a diff's rows, through the user's template: a line or a hunk with a click
 * (`copyTarget`), text selected with the mouse, exactly, when the button comes up. What was
 * copied flashes and says what it was (`flash`), in the part of the list on screen; a new key
 * each time replays both. `hovered` is what a click would copy, under the pointer.
 */
export function useRowCopy({
    listRef,
    scrollElement,
    source,
    rows,
    hunks,
    layout,
}: {
    listRef: RefObject<HTMLDivElement | null>;
    scrollElement: HTMLDivElement;
    source: CopySource;
    rows: readonly DiffRow[];
    hunks: readonly DiffHunk[];
    layout: DiffLayout;
}) {
    const { copyTemplate } = useRepositorySettings();
    const { copied, copy } = useCopyToClipboard();
    const i18n = useTranslation();
    const [flash, setFlash] = useState<Flash | null>(null);
    const copyRows = (copiedValue: Copied, span: Span, label: string) => {
        const width = listRef.current?.offsetWidth ?? 0;
        const right = Math.max(0, width - scrollElement.scrollLeft - scrollElement.clientWidth);
        setFlash((current) => ({ ...span, label, right, key: (current?.key ?? 0) + 1 }));
        void copy('diff', copiedText(copyTemplate, copiedValue));
    };
    const copyTarget = (target: Target) => {
        const span = targetSpan(layout, target);
        const copiedValue = targetCopied(source, rows, hunks, target, i18n);
        if (span && copiedValue) copyRows(copiedValue, span, copiedLabel(copiedValue, i18n));
    };
    const hovered = useDiffPointer(listRef, rows, {
        click: copyTarget,
        select: (text, span) => {
            const lines = rows
                .slice(span.first, span.last + 1)
                .flatMap((row): DiffLine[] => (row.kind === 'line' ? [row.line] : []));
            copyRows(
                selectionCopied(source, lines, text, i18n),
                span,
                i18n.t('copy.copiedSelection'),
            );
        },
    });
    return { copied, flash, copyTarget, hovered };
}

/** What a click on a target copies: its hunk, or its line; null for neither. */
function targetCopied(
    source: CopySource,
    rows: readonly DiffRow[],
    hunks: readonly DiffHunk[],
    target: Target,
    i18n: Translator,
): Copied | null {
    const hunk = target.kind === 'hunk' ? hunks[target.hunk] : undefined;
    if (hunk) return hunkCopied(source, hunk, i18n);
    const row = target.kind === 'line' ? rows[target.row] : undefined;
    return row?.kind === 'line' ? lineCopied(source, row.line, i18n) : null;
}
