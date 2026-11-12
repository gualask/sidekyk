import { Autocomplete } from '@base-ui/react/autocomplete';
import { IconFile, IconFolderCode, IconList, IconNote } from '@tabler/icons-react';
import type { CSSProperties } from 'react';
import { CHANGE_MARK_TONE, CHANGE_MARK_WORD } from '@/shared/git/change-mark';
import { type Translator, useTranslation } from '@/shared/i18n';
import { FolderPath } from '@/shared/projects/FolderPath';
import { RemoteTag } from '@/shared/projects/RemoteTag';
import { KeyCap } from '@/shared/ui/KeyCaps';
import { MatchedText } from '@/shared/ui/MatchedText';
import type { PaletteItem, PaletteRow as Row } from '../model/palette-rows';
import type { Highlight } from '../model/search.types';

/**
 * A row of the virtualized list, placed at `start`: a group's or a file's heading, the files left
 * out, or an item to open.
 */
export function PaletteRow({
    row,
    count,
    start,
    size,
    onOpen,
}: {
    row: Row;
    count: number;
    start: number;
    size: number;
    onOpen: (item: PaletteItem) => void;
}) {
    const { tp } = useTranslation();
    const style = rowStyle(start, size);

    if (row.kind === 'group') {
        return (
            <div
                role="presentation"
                style={style}
                className="flex items-end px-[18px] pb-1 text-[11px] font-semibold tracking-[.04em] text-ui-text-muted uppercase"
            >
                {row.label}
            </div>
        );
    }
    if (row.kind === 'file') {
        return (
            <div
                role="presentation"
                style={style}
                className="flex items-end gap-2 px-[18px] pb-1 font-mono text-[12px] text-ui-text-secondary"
            >
                <span className="min-w-0 truncate">{row.path}</span>
                <span className="ml-auto shrink-0 font-sans text-[11px] text-ui-text-muted">
                    {row.count}
                </span>
            </div>
        );
    }
    if (row.kind === 'more') {
        return (
            <div
                role="presentation"
                style={style}
                className="flex items-center px-[18px] text-xs text-ui-text-muted"
            >
                {tp('palette.moreFiles', row.count)}
            </div>
        );
    }
    return (
        <ItemRow item={row.item} index={row.index} count={count} style={style} onOpen={onOpen} />
    );
}

/** Where a row sits in the list's scrolled box. */
function rowStyle(start: number, size: number): CSSProperties {
    return {
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: size,
        transform: `translateY(${start}px)`,
    };
}

/** An item to open: its icon or line number, its label with the letters matched, its hint. */
function ItemRow({
    item,
    index,
    count,
    style,
    onOpen,
}: {
    item: PaletteItem;
    index: number;
    count: number;
    style: CSSProperties;
    onOpen: (item: PaletteItem) => void;
}) {
    const { t } = useTranslation();
    return (
        <div role="presentation" style={style} className="px-1.5">
            <Autocomplete.Item
                value={item}
                index={index}
                aria-setsize={count}
                aria-posinset={index + 1}
                onClick={() => onOpen(item)}
                className="pick-row group h-full"
            >
                {item.kind === 'line' ? (
                    <span className="w-9 shrink-0 text-right font-mono text-[11px] text-ui-text-muted tabular-nums group-data-highlighted:text-ui-accent-on-soft">
                        {item.number}
                    </span>
                ) : (
                    <KindIcon item={item} />
                )}
                {item.kind === 'project' ? (
                    <span className="flex min-w-0 flex-col">
                        <Label text={item.label} highlights={item.highlights} mono={false} />
                        {item.folder ? <FolderPath path={item.folder.root} /> : null}
                    </span>
                ) : (
                    <Label
                        text={item.label}
                        highlights={item.highlights}
                        mono={item.kind === 'file' || item.kind === 'line'}
                    />
                )}
                <span className="ml-auto shrink-0 text-xs text-ui-text-muted group-data-highlighted:text-ui-accent-on-soft">
                    {hint(item, t)}
                </span>
            </Autocomplete.Item>
        </div>
    );
}

const KIND_ICONS = { project: IconFolderCode, file: IconFile, list: IconList, note: IconNote };

/** What a row opens, at a glance: a project, a panel (its tile's icon), a file, a list, a note. */
function KindIcon({ item }: { item: Exclude<PaletteItem, { kind: 'line' }> }) {
    const Icon = item.kind === 'panel' ? item.icon : KIND_ICONS[item.kind];
    return (
        <Icon
            size={16}
            stroke={1.75}
            className="shrink-0 text-ui-text-muted group-data-highlighted:text-ui-accent-on-soft"
        />
    );
}

/**
 * What a row says on its right: a panel's key, how a file changed, a note's list (and project, at
 * all projects), a list's project at all projects, a project's machine when not this one.
 */
function hint(item: PaletteItem, t: Translator['t']) {
    if (item.kind === 'project') return <RemoteTag folder={item.folder} />;
    if (item.kind === 'panel') return <KeyCap keys={item.shortcut} />;
    if (item.kind === 'note' || item.kind === 'list') return item.hint;
    if (item.kind !== 'file' || !item.mark) return null;
    return <span className={CHANGE_MARK_TONE[item.mark]}>{t(CHANGE_MARK_WORD[item.mark])}</span>;
}

/** The item's text, with the letters the query matched in bold. */
function Label({
    text,
    highlights,
    mono,
}: {
    text: string;
    highlights: readonly Highlight[];
    mono: boolean;
}) {
    return (
        <MatchedText
            text={text}
            highlights={highlights}
            className={`min-w-0 truncate ${mono ? 'font-mono text-[12.5px]' : ''}`}
        />
    );
}
