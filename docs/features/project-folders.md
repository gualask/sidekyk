# Project folders

A project follows none, one or several folders (a product in repositories: api, web, ops), one on
screen at a time; its notes are the project's. Identity and kind: `projects.md`; rows: `overview.md`.

## Behaviour

- One on screen: Changes and Files show the folder on screen; Notes the project's.
  With several, the breadcrumb gains a step, `All projects / Shop / api ▾`: its menu lists the
  folders, each with its branch and changes (read when it opens, never starting a stopped WSL
  distro), the one on screen checked; a pick shows it at the same zoom; "Edit folders…" last.
- Entering a project of several folders asks which: its row (click, `↵`), the
  palette, a note found in it or `[`/`]` at a project's panels open a dialog, "Open shop", a
  field to narrow them (ranked as the palette ranks names), a row per folder: name
  and place, branch, files changed, lines, in columns (the breadcrumb's menu has the same,
  `FOLDER_COLUMNS`). The project's order, the first
  chosen: `↵ ↵` is always the first, `↵ ↓ ↵` the second. `Esc` leaves everything as it was. What names the folder enters it at once
  (`sidekyk <folder>`), and so does a project of one folder.
- Changes clean while another repository of the project has changes: "web: 3 files changed →"
  under "Nothing to review", a click shows it. Read once as it shows, no watcher.
- Level 0 row of several folders: their names under the project's (the branch and changes of
  each in the tooltip), the lines not committed in its repositories added up beside them, their
  commits in one week. A repository that cannot be read is left out there: the top bar tells why.
- Edit (the row's ⋯, or "Edit folders…"): name and folders. A folder added or removed changes the
  project at once, as VS Code's "Add Folder to Workspace" (the folder untouched, the notes kept);
  the name waits for Save. The folders are on one machine (this one, or one WSL distro;
  `folder_elsewhere`), none the same as another, inside or holding one (`folder_overlaps`).
- A folder that is another project's offers to merge that project: "web is already a project.
  Merge it into Shop?" Its folders come after the project's, its lists of notes move whole (one
  whose name the project has gets its project's after it, "General (web)", so nothing mixes
  unseen; a list without notes stays behind), and it goes with its layout. "Keep apart" leaves
  both.
- A folder without git picked first in New project, with repositories right inside it (a parent of
  api and web): "Projects holds 4 repositories: api, billing, docs (in Docs), …", and what it
  becomes: One project (its repositories no project has, the default), A project each ("Create 2
  projects", the name taken from each), Just the folder. Taken silently, it would be a project
  without git: no Changes, nothing said.
- `sidekyk <parent>` of the same kind opens New project on it at level 0 instead of adding a
  project without git.

## How it is built

- Folder ids: `ProjectFolder { id, …Location }`, made once (`new_id`), kept when the
  folder moves (Locate…) or its project merges. Every repository command, the
  `project-file:` URL and `repository-changed` (version 5, `folderId`) name the folder, so each
  repository has its own cache: back to a folder is instant. A folder stored without id was its
  project's only one and takes the project's id; nothing is migrated.
- `ProjectList::folder(id)` finds a folder of a project of the list, any other id refused;
  `add_folder`, `remove_folder`, `merge`, `relocate(folder)`; refusals in `checked_beside`
  (`Location::same_machine`, `overlaps`, in `place.rs`). Commands `add_project_folder`,
  `remove_project_folder`, `merge_projects` (notes first, `NotesStore::merge_book`, then the
  list; the list's check runs before any note moves), `relocate_folder`.
- The folder on screen is the window's, as its zoom level: `useProjectEntry`
  (`app/project-entry.ts`) keeps the one picked of each project for the session
  (`folderOnScreen`: that one, else the project's only one), never stored, and is every way into
  a project. `useFolderOnScreen` tells the folder to the backend, in order
  (`show_project_folder`, `null` for none), which keeps it in memory (`Projects::show_folder`):
  the folder watched (`watch_on_screen` compares its id and place) and the one `⌘K` searches.
  Others are read when their menu, row or hint shows, as level 0 reads the projects not on
  screen. A project of several folders none picked (its folder removed) shows level 0.
- Repositories inside (`folder::repositories_inside`, through the helper too,
  `RepositoriesInside`): a folder without git's subfolders with a `.git` at their root, links not
  followed, by name; one `readdir` and one `lstat` each, only when a folder is picked or given.
  `FolderChoice::Usable.repositories` says each one's path, place and project.
- Command line: `open_folder` answers `Opened::Project` (with the folder) or `Opened::Choice`, taken once
  (`take_opened`); the app passes the choice to the overview, which opens `NewProjectDialog` on it.
- Frontend: `PanelProps.folder` (the one shown) and `showFolder`; `useProjectKind` (a project of
  several folders has a repository's panels on its row when one is), `useRepositorySummaries`,
  `useCommitActivities` (`mergedActivity`), `summedTotals`; `FolderMenu` and `FolderPicker` (lazy,
  preloaded when idle) in `app/`; `FolderFacts` gives a row's cells, empty while read, so the
  columns (`FOLDER_COLUMNS`) hold. The panel is keyed by project and folder: another folder is
  another panel, as left there.

## Decisions

- Several folders in one project: the notes. A product split in repositories has
  notes of the whole (a flow across api and web), and a global capture lands in the project on
  screen; one project per repository would split them. Lists stay the topics inside it (a list per
  repository if wanted), not another level of notes.
- One on screen, not sections: switching costs `Esc` and a click, two diffs are read
  one after the other anyway, and sections with summed views would make every file a folder and a
  path in every module. As Zed's git panel, one repository at a time with a picker; VS Code shows
  them all, or one in its single repository mode
  (code.visualstudio.com/docs/sourcecontrol/repos-remotes).
- No level between all projects and a project: it would repeat the row and Notes and
  make the depth differ per project; the menu tells which repository changed. Again if projects of
  5+ repositories outgrow it.
- Asked at each entering, not the last shown: entering one knows which repository it
  is for, and nobody remembers which was shown last, so restoring it entered the wrong one. A
  dialog, not a menu under the row nor rows under it: one place for every entry (row,
  palette, keys), room for each folder's place and facts, the row unchanged. The order fixed, not
  the last used first, so the keys stay the same.
- A parent of repositories asks: VS Code finds repositories one level below the
  folder opened by default (its `git.repositoryScanMaxDepth` setting, 1), Zed at any depth; taken
  silently as a folder without git it showed no changes.
- `⌘K` searches the files of the folder on screen: across folders it needs a file as folder and
  path everywhere, the cost avoided; added if missed.
