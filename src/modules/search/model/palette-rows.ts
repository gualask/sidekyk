import type { Translator } from '@/shared/i18n';
import { projectFolder } from '@/shared/projects/project-info';
import type { PaletteBook, PaletteItem, PalettePanel, PaletteRow } from './palette-items';
import type { SearchResults } from './search.types';

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
