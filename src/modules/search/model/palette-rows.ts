import type { ChangeMark } from '@/shared/git/change-mark';
import type { Translator } from '@/shared/i18n';
import type { PanelDefinition } from '@/shared/panels/panel';
import type { ProjectLocation } from '@/shared/projects/project-info';
import type { ContentFile, Highlight, SearchResults } from './search.types';

/** A panel as the palette offers it. */
export interface PalettePanel {
    id: string;
    title: string;
    /** As on its tile. */
    icon: PanelDefinition['icon'];
    /** The key that opens it full screen. */
    shortcut: string;
}

/** Something the palette opens. */
export type PaletteItem =
    | {
          kind: 'project';
          projectId: string;
          /** Its folder, under the name; its machine the row's hint when not this one. */
          location: ProjectLocation;
          label: string;
          highlights: Highlight[];
      }
    | {
          kind: 'panel';
          id: string;
          icon: PalettePanel['icon'];
          shortcut: string;
          label: string;
          highlights: Highlight[];
      }
    | {
          kind: 'file';
          path: string;
          mark: ChangeMark | null;
          label: string;
          highlights: Highlight[];
      }
    | { kind: 'list'; id: string; label: string; highlights: Highlight[] }
    | {
          kind: 'note';
          id: string;
          list: string;
          /** Its list's name: the row's hint. */
          listName: string;
          /** Its first line, or the part of it where the text typed is. */
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

/** Typed, this many of each kind come first, so a kind found by the dozen hides no other. */
const FIRST_OF_EACH = 2;

interface Ranked {
    item: PaletteItem;
    score: number;
}

/**
 * The items, in the order the list shows them, and the rows that show them. With nothing typed,
 * where to go under its title (the projects, or the panels); typed, one list by score, the best
 * two of each kind first, equal scores a name chosen (project, panel, list), then a file, then a
 * note.
 */
export function paletteRows(
    results: SearchResults,
    panels: readonly PalettePanel[],
    projectName: string | null,
    typed: boolean,
    { t }: Translator,
): { items: PaletteItem[]; rows: PaletteRow[] } {
    const projects: Ranked[] = results.projects.map((project) => ({
        item: {
            kind: 'project',
            projectId: project.id,
            location: project.location,
            label: project.name,
            highlights: project.highlights,
        },
        score: project.score,
    }));
    const panelsFound = results.panels.flatMap((match): Ranked[] => {
        const panel = panels[match.index];
        return panel
            ? [
                  {
                      item: {
                          kind: 'panel',
                          id: panel.id,
                          icon: panel.icon,
                          shortcut: panel.shortcut,
                          label: panel.title,
                          highlights: match.highlights,
                      },
                      score: match.score,
                  },
              ]
            : [];
    });
    const lists: Ranked[] = results.lists.map((list) => ({
        item: { kind: 'list', id: list.id, label: list.name, highlights: list.highlights },
        score: list.score,
    }));
    const notes: Ranked[] = results.notes.map((note) => ({
        item: {
            kind: 'note',
            id: note.id,
            list: note.list,
            listName: note.listName,
            label: note.snippet?.text ?? note.title,
            highlights: note.snippet?.highlights ?? note.highlights,
        },
        score: note.score,
    }));
    const files: Ranked[] = results.files.map((file) => ({
        item: {
            kind: 'file',
            path: file.path,
            mark: file.mark,
            label: file.path,
            highlights: file.highlights,
        },
        score: file.score,
    }));

    const items: PaletteItem[] = [];
    const rows: PaletteRow[] = [];
    const add = ({ item }: Ranked) => {
        rows.push({ kind: 'item', item, index: items.length });
        items.push(item);
    };
    if (typed) {
        // each kind comes best first; the order of the kinds breaks ties
        const ranked = [projects, panelsFound, lists, files, notes].flatMap((found, kind) =>
            found.map((entry, place) => ({ ...entry, kind, first: place < FIRST_OF_EACH })),
        );
        ranked.sort(
            (a, b) => Number(b.first) - Number(a.first) || b.score - a.score || a.kind - b.kind,
        );
        ranked.forEach(add);
    } else {
        const name = projectName ?? '';
        const groups = [
            { label: t('palette.projects'), found: projects },
            {
                label: projectName ? t('palette.panelsIn', { name }) : t('palette.panels'),
                found: panelsFound,
            },
        ];
        for (const { label, found } of groups) {
            if (found.length === 0) continue;
            rows.push({ kind: 'group', label });
            found.forEach(add);
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
    { t }: Translator,
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
        rows.push({ kind: 'group', label: t('palette.inThisFile') });
        addLines(shown);
    }
    const others = files.filter((file) => file !== shown);
    if (shown && others.length > 0) rows.push({ kind: 'group', label: t('palette.otherFiles') });
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
