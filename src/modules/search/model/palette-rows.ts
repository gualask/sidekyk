import type { ChangeMark } from '@/shared/git/change-mark';
import type { ContentFile, Highlight, SearchResults } from './search.types';

/** A panel as the palette offers it. */
export interface PalettePanel {
    id: string;
    title: string;
    /** The key that opens it full screen. */
    shortcut: string;
}

/** Something the palette opens. */
export type PaletteItem =
    | { kind: 'project'; root: string; label: string; highlights: Highlight[] }
    | { kind: 'panel'; id: string; shortcut: string; label: string; highlights: Highlight[] }
    | {
          kind: 'file';
          path: string;
          mark: ChangeMark | null;
          label: string;
          highlights: Highlight[];
      }
    | {
          kind: 'line';
          path: string;
          /** The line's number in the file. */
          number: number;
          label: string;
          highlights: Highlight[];
      };

/** The list as one flat run of rows, so only the rows on screen are rendered. */
export type PaletteRow =
    | { kind: 'group'; label: string }
    | { kind: 'item'; item: PaletteItem; index: number }
    | { kind: 'more'; count: number }
    | { kind: 'file'; path: string; count: number };

/** The items, in the order the list shows them, and the rows that show them under their groups. */
export function paletteRows(
    results: SearchResults,
    panels: readonly PalettePanel[],
    projectName: string | null,
): { items: PaletteItem[]; rows: PaletteRow[] } {
    const groups: { label: string; items: PaletteItem[] }[] = [
        {
            label: 'Projects',
            items: results.projects.map((project) => ({
                kind: 'project',
                root: project.root,
                label: project.name,
                highlights: project.highlights,
            })),
        },
        {
            label: projectName ? `Panels in ${projectName}` : 'Panels',
            items: results.panels.flatMap((match): PaletteItem[] => {
                const panel = panels[match.index];
                return panel
                    ? [
                          {
                              kind: 'panel',
                              id: panel.id,
                              shortcut: panel.shortcut,
                              label: panel.title,
                              highlights: match.highlights,
                          },
                      ]
                    : [];
            }),
        },
        {
            label: projectName ? `Files in ${projectName}` : 'Files',
            items: results.files.map((file) => ({
                kind: 'file',
                path: file.path,
                mark: file.mark,
                label: file.path,
                highlights: file.highlights,
            })),
        },
    ];

    const items: PaletteItem[] = [];
    const rows: PaletteRow[] = [];
    for (const group of groups) {
        if (group.items.length === 0) continue;
        rows.push({ kind: 'group', label: group.label });
        for (const item of group.items) {
            rows.push({ kind: 'item', item, index: items.length });
            items.push(item);
        }
    }
    if (results.moreFiles > 0) rows.push({ kind: 'more', count: results.moreFiles });
    return { items, rows };
}

/**
 * The lines found in the files' contents, under their files: those of the file shown first, as
 * "In this file", then the others' in their order.
 */
export function contentRows(
    files: readonly ContentFile[],
    current: string | null,
): { items: PaletteItem[]; rows: PaletteRow[] } {
    const items: PaletteItem[] = [];
    const rows: PaletteRow[] = [];
    const addLines = (file: ContentFile) => {
        for (const line of file.lines) {
            const item: PaletteItem = {
                kind: 'line',
                path: file.path,
                number: line.number,
                label: line.text,
                highlights: line.highlights,
            };
            rows.push({ kind: 'item', item, index: items.length });
            items.push(item);
        }
    };
    const shown = files.find((file) => file.path === current);
    if (shown) {
        rows.push({ kind: 'group', label: 'In this file' });
        addLines(shown);
    }
    const others = files.filter((file) => file !== shown);
    if (shown && others.length > 0) rows.push({ kind: 'group', label: 'Other files' });
    for (const file of others) {
        rows.push({ kind: 'file', path: file.path, count: file.lines.length });
        addLines(file);
    }
    return { items, rows };
}

/** A part of a text, where it starts in it, and whether the query matched it. */
export interface TextPart {
    text: string;
    start: number;
    matched: boolean;
}

/** A text cut into the parts the query matched and the parts between them. */
export function highlightParts(text: string, highlights: readonly Highlight[]): TextPart[] {
    const parts: TextPart[] = [];
    let at = 0;
    for (const [start, end] of highlights) {
        if (start > at) parts.push({ text: text.slice(at, start), start: at, matched: false });
        parts.push({ text: text.slice(start, end), start, matched: true });
        at = end;
    }
    if (at < text.length) parts.push({ text: text.slice(at), start: at, matched: false });
    return parts;
}
