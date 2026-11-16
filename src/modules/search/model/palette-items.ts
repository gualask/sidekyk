import type { Highlight } from '@/shared/format/highlight-parts';
import type { ChangeMark } from '@/shared/git/change-mark';
import type { PanelDefinition } from '@/shared/panels/panel';
import type { ProjectAvatar, ProjectLocation } from '@/shared/projects/project-info';

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
