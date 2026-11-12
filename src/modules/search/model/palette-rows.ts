import type { ChangeMark } from '@/shared/git/change-mark';
import type { Translator } from '@/shared/i18n';
import type { PanelDefinition } from '@/shared/panels/panel';
import {
    type ProjectAvatar,
    type ProjectLocation,
    projectFolder,
} from '@/shared/projects/project-info';
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

/**
 * The book of a list or note found at all projects, as its row names it: a project, or the Inbox
 * (its one list never named).
 */
export interface PaletteBook {
    name: string;
    inbox: boolean;
}

/** Something the palette opens. */
export type PaletteItem =
    | {
          kind: 'project';
          projectId: string;
          /** Its folder, under the name; its machine the row's hint when not this one. */
          folder: ProjectLocation | null;
          /** In place of the other rows' icon. */
          avatar: ProjectAvatar;
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
    | {
          kind: 'list';
          book: string;
          id: string;
          /** Its project's name at all projects: the row's hint. */
          hint: string | null;
          label: string;
          highlights: Highlight[];
      }
    | {
          kind: 'note';
          book: string;
          id: string;
          list: string;
          /** Its list's name, in its project's at all projects, or the Inbox's: the row's hint. */
          hint: string;
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

/** Items under a title, or none when `label` is null. */
interface RankedGroup {
    label: string | null;
    found: Ranked[];
}

/**
 * The items, in the order the list shows them, and the rows that show them. With nothing typed,
 * where to go under its title (the projects, or the panels); typed, one list by score, the best
 * two of each kind first, equal scores a name chosen (project, panel, list), then a file, then a
 * note. `books` names the books of the lists and notes found at all projects; null inside a
 * project, whose own they all are.
 */
export function paletteRows(
    results: SearchResults,
    panels: readonly PalettePanel[],
    projectName: string | null,
    typed: boolean,
    books: ((book: string) => PaletteBook) | null,
    i18n: Translator,
): { items: PaletteItem[]; rows: PaletteRow[] } {
    const projects = foundProjects(results.projects);
    const panelsFound = foundPanels(results.panels, panels);
    const groups = typed
        ? [
              {
                  label: null,
                  found: byScore([
                      projects,
                      panelsFound,
                      foundLists(results.lists, books),
                      foundFiles(results.files),
                      foundNotes(results.notes, books, i18n),
                  ]),
              },
          ]
        : placesToGo(projects, panelsFound, projectName, i18n);
    const { items, rows } = rowsOf(groups);
    if (results.moreFiles > 0) rows.push({ kind: 'more', count: results.moreFiles });
    return { items, rows };
}

function foundProjects(found: SearchResults['projects']): Ranked[] {
    return found.map((project) => ({
        item: {
            kind: 'project',
            projectId: project.id,
            folder: projectFolder(project),
            avatar: project.avatar,
            label: project.name,
            highlights: project.highlights,
        },
        score: project.score,
    }));
}

function foundPanels(found: SearchResults['panels'], panels: readonly PalettePanel[]): Ranked[] {
    return found.flatMap((match): Ranked[] => {
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
}

function foundLists(
    found: SearchResults['lists'],
    books: ((book: string) => PaletteBook) | null,
): Ranked[] {
    return found.map((list) => ({
        item: {
            kind: 'list',
            book: list.book,
            id: list.id,
            hint: books ? books(list.book).name : null,
            label: list.name,
            highlights: list.highlights,
        },
        score: list.score,
    }));
}

function foundFiles(found: SearchResults['files']): Ranked[] {
    return found.map((file) => ({
        item: {
            kind: 'file',
            path: file.path,
            mark: file.mark,
            label: file.path,
            highlights: file.highlights,
        },
        score: file.score,
    }));
}

function foundNotes(
    found: SearchResults['notes'],
    books: ((book: string) => PaletteBook) | null,
    i18n: Translator,
): Ranked[] {
    return found.map((note) => ({
        item: {
            kind: 'note',
            book: note.book,
            id: note.id,
            list: note.list,
            hint: noteHint(books?.(note.book) ?? null, note.listName, i18n),
            label: note.snippet?.text ?? note.title,
            highlights: note.snippet?.highlights ?? note.highlights,
        },
        score: note.score,
    }));
}

/** Its list's name; at all projects, in its project's, or the Inbox's name alone. */
function noteHint(where: PaletteBook | null, list: string, { t }: Translator): string {
    if (!where) return list;
    return where.inbox ? where.name : t('palette.noteIn', { list, project: where.name });
}

/** Each kind best first, its first FIRST_OF_EACH ahead of all; the order of the kinds breaks ties. */
function byScore(kinds: readonly Ranked[][]): Ranked[] {
    const ranked = kinds.flatMap((found, kind) =>
        found.map((entry, place) => ({ ...entry, kind, first: place < FIRST_OF_EACH })),
    );
    return ranked.sort(
        (a, b) => Number(b.first) - Number(a.first) || b.score - a.score || a.kind - b.kind,
    );
}

/** With nothing typed: the projects, then the panels, each under its title. */
function placesToGo(
    projects: Ranked[],
    panels: Ranked[],
    projectName: string | null,
    { t }: Translator,
): RankedGroup[] {
    const name = projectName ?? '';
    return [
        { label: t('palette.projects'), found: projects },
        {
            label: projectName ? t('palette.panelsIn', { name }) : t('palette.panels'),
            found: panels,
        },
    ];
}

/** A group with nothing found shows no row, not even its title. */
function rowsOf(groups: readonly RankedGroup[]): { items: PaletteItem[]; rows: PaletteRow[] } {
    const items: PaletteItem[] = [];
    const rows: PaletteRow[] = [];
    for (const { label, found } of groups.filter((group) => group.found.length > 0)) {
        if (label !== null) rows.push({ kind: 'group', label });
        for (const { item } of found) {
            rows.push({ kind: 'item', item, index: items.length });
            items.push(item);
        }
    }
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
