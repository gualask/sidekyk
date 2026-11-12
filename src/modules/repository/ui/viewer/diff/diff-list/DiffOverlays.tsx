import { IconCheck, IconCopy, IconCopyOff } from '@tabler/icons-react';
import { useTranslation } from '@/shared/i18n';
import type { CopyState } from '@/shared/ui/hooks/use-copy-to-clipboard';
import { BRACKET_WIDTH, type DiffLayout, type Span, spanBox } from '../diff-layout';
import type { Flash } from './use-row-copy';

/**
 * Each hunk's lines held by a bracket in the gutter, a copy icon at its top: a click on the
 * numbers copies the hunk. Only the hunks on screen (`brackets`); the one under the pointer
 * (`hovered`) lights up.
 */
export function HunkBrackets({
    layout,
    brackets,
    hovered,
}: {
    layout: DiffLayout;
    brackets: readonly { hunk: number; lines: Span }[];
    /** The hunk a click would copy; -1 for none. */
    hovered: number;
}) {
    return brackets.map(({ hunk, lines }) => (
        <div
            key={hunk}
            aria-hidden
            className={`pointer-events-none absolute left-0 ${
                hunk === hovered ? 'text-ui-accent' : 'text-ui-text-muted opacity-50'
            }`}
            style={{ ...spanBox(layout, lines), width: BRACKET_WIDTH }}
        >
            <IconCopy size={11} className="absolute top-[4.5px] left-[2.5px]" />
            {lines.last > lines.first ? (
                <span className="absolute top-[18px] bottom-1 left-[7.5px] w-1 rounded-bl-[2px] border-b border-l border-current" />
            ) : null}
        </div>
    ));
}

/** What was copied flashing, and a chip at its top right saying what it was, or that it failed. */
export function CopyFlash({
    layout,
    copied,
    flash,
}: {
    layout: DiffLayout;
    copied: CopyState;
    flash: Flash | null;
}) {
    const i18n = useTranslation();
    return (
        <div role="status" className="contents">
            {copied && flash ? (
                <div key={flash.key} className="contents">
                    <div
                        aria-hidden
                        className={`pointer-events-none absolute left-0 w-full ${
                            copied.ok ? 'copy-flash' : 'copy-flash-failed'
                        }`}
                        style={spanBox(layout, flash)}
                    />
                    <span
                        className={`copied-chip pointer-events-none absolute z-10 mt-0.5 flex h-4 items-center gap-1 rounded px-1.5 font-sans text-[10.5px] font-semibold shadow-sm ${
                            copied.ok
                                ? 'bg-ui-accent-solid text-ui-accent-on-solid'
                                : 'bg-ui-danger text-ui-accent-on-solid'
                        }`}
                        style={{ top: layout.starts[flash.first] ?? 0, right: flash.right + 8 }}
                    >
                        {copied.ok ? <IconCheck size={11} /> : <IconCopyOff size={11} />}
                        {copied.ok ? flash.label : i18n.t('copy.failed')}
                    </span>
                </div>
            ) : null}
        </div>
    );
}
