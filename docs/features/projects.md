# Projects

A project is a name, its notes and none, one or several folders, each a repository or a folder
without git, one on screen (`project-folders.md`). Several projects, one on screen; how level 0
shows them: `overview.md`.

## Behaviour

- New project (2026-10-23): the button over the projects at level 0 opens one dialog for everyone: Name and
  Folders (optional; "None" until Add folder…), Create disabled while the name is blank. A folder
  inside a repository becomes the repository's root, any other is taken as it is (2026-10-24); the
  first one's name fills an empty name. Another project's folder is said under them, with Open; a
  folder above repositories asks what it becomes (`project-folders.md`). Create opens the new
  project at level 1.
- Edit from the row's ⋯: name and folders (`project-folders.md`); two projects may share a name.
  Remove from the row's ⋯: the folder is untouched, the notes are exported or deleted first
  (`notes.md`).
- `sidekyk <folder>` opens the project of that folder, showing it, adding one named after it if
  none; a folder above repositories opens New project on it instead.
- What a folder is (2026-10-24): a repository when a `.git` (folder, or file for worktrees and
  submodules) is at its root, else a folder without git. Never stored: `git init` or `.git`
  removed changes the panels while the app runs (`workspace.md`).
- Top bar facts: branch, ahead/behind, changed files and lines against HEAD (`1.2k changed +1.2k
  −340`), or "clean".
- A folder moved or deleted: problem `repository_missing` with Locate… (the project follows the
  folder, which keeps its id; the project its name, notes and layout) and Remove. Another project's folder is refused with
  a toast and Open.

## How it is built

- Identity: `{ id, name, folders }`, a folder `{ id }` and local `{ root }` or WSL
  `{ distro, root }` (`project-folders.md`). Everything of a project (layout, notes, avatar color)
  is keyed by `id`, everything of a folder (queries, session state) by its own, made once (16
  random hex digits, `shared/id.rs`), never read by the frontend. Older stored forms are read: a
  folder without id (its project's), `{ id, name, location }`, and before ids `{ name, location }`
  and `{ root, name }`, whose id is their location (`Location::id_before_made_ids`), so their
  notes and layouts stay. One that cannot be read is
  left out, not the whole list. Stored in app data beside the settings; changes run in one
  mutation scope, in order.
- A folder is one project's: `ProjectList::at` finds a project by place (`Location::same_place`:
  roots by component, case ignored on macOS and Windows, the distro too). Places are compared only
  in `modules/projects/place.rs`, also for an export inside a project (`holds`).
- Opening a folder (`resolve_folder`, `modules/folder/open.rs`): its real path (links resolved on
  Unix, as the watcher reports; as given on Windows); the nearest folder at or above it with a
  `.git` is a repository, its root from `git rev-parse --show-toplevel`, or that folder when git
  fails; no `.git`, the folder itself and no git runs (on macOS without the Command Line Tools
  `/usr/bin/git` asks to install them).
- Kind (`get_folder_kind`, `folder::folder_kind`, no git): `repository_missing` for a folder gone,
  else whether `.git` is at the root. One query for the rows and level 1 (`useFolderKind`); a kind that
  cannot be read counts as a repository, its panels and problems telling why. A change of kind
  comes from the watcher (`kind_changed`) and resets the folder's queries.
- Dialogs (`NewProjectDialog` in the overview, `EditProjectDialog` from the app, lazy):
  `choose_project_folder` picks a folder and says what it is (`FolderChoice`: `Usable { path,
  name, location, repositories }`, `InProject { id, name }`), changing nothing; `create_project`
  checks the folders again; `rename_project` stores only. Failures show in the dialog.
- Locate… (`relocate_folder`): the folder resolves as a new project's and replaces the folder's
  place, its id kept; another project's is `FolderChange::InProject`. `watch_on_screen` compares the
  folder's id and place, the frontend reads the folder again (`useReadFolderAgain`).
- Without folder: no folder to name, never routed, watched or summarized. A folder without git is routed and watched, never
  asked for a snapshot, summary, diff or commits.

## Decisions

- One container, the project (2026-10-22): not global notes beside projects (two navigations, two
  places for a note); lists are topics inside it, the Inbox the one place outside. Panels come
  from what a project has, never from a template the user picks. One folder first, the model
  shaped for several (VS Code's multi-root workspace) so stored projects change once; several
  built 2026-11-02 (`project-folders.md`).
- Id made once and kept (2026-10-22; made from the location 2026-10-18): a project without folder
  has no location, one with several no single one. A folder is one project's, found by place;
  stored ids stay, nothing migrated.
- Locate… onto another project's folder refused (2026-10-22), not a merge: it changes a folder
  only.
- Kind by its own query, not from the summary (2026-10-24): at level 1 the summary comes with the
  snapshot, so reading it first would run `git status` twice.
