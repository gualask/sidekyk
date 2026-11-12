# Projects

A project is a name, its notes and none, one or several folders, each a repository or a folder
without git, one on screen (`project-folders.md`). Several projects, one on screen; how level 0
shows them: `overview.md`.

## Behaviour

- New project: the button over the projects at level 0 opens one dialog for everyone: Name and
  Folders (optional; "None" until Add folder…), Create disabled while the name is blank. A folder
  inside a repository becomes the repository's root, any other is taken as it is; the
  first one's name fills an empty name. Another project's folder is said under them, with Open; a
  folder above repositories asks what it becomes (`project-folders.md`). Create opens the new
  project at level 1.
- Edit from the row's ⋯: name, avatar and folders (`project-folders.md`); two projects may share
  a name.
- Avatar, at level 0 and in the palette: one or two letters on one of 10 colors, the same in both
  themes, each 4.6:1 at least under its white letters. A new project takes the color fewest
  projects have, the first on a tie, so none repeats while one is free. The letters come from the
  name: the first of its first and last words (`my-shop-api` MA), else a word's first letter and
  the capital of its second hump (`SideKyk` SK), else its first letter (`shop` S). Edit changes the
  color (10 swatches) and writes one or two letters or digits in place of the name's (blank: the
  name's again), as `SW` for the WSL clone of `shop`.
  Remove from the row's ⋯: the folder is untouched, the notes are exported or deleted first
  (`notes.md`).
- `sidekyk <folder>` opens the project of that folder, showing it, adding one named after it if
  none; a folder above repositories opens New project on it instead.
- What a folder is: a repository when a `.git` (folder, or file for worktrees and
  submodules) is at its root, else a folder without git. Never stored: `git init` or `.git`
  removed changes the panels while the app runs (`workspace.md`).
- Top bar facts: branch, ahead/behind, changed files and lines against HEAD (`1.2k changed +1.2k
  −340`), or "clean".
- A folder moved or deleted: problem `repository_missing` with Locate… (the project follows the
  folder, which keeps its id; the project its name, notes and layout) and Remove. Another project's folder is refused with
  a toast and Open.

## How it is built

- Identity: `{ id, name, folders, avatar }`, a folder `{ id }` and local `{ root }` or WSL
  `{ distro, root }` (`project-folders.md`), the avatar `{ color, letters }` (`letters` null for
  the name's). Everything of a project (layout, notes) is keyed by `id`, everything of a folder (queries, session state) by its own, made once (16
  random hex digits, `shared/id.rs`), never read by the frontend. Older stored forms are read: a
  folder without id (its project's), `{ id, name, location }`, and before ids `{ name, location }`
  and `{ root, name }`, whose id is their location (`Location::id_before_made_ids`), so their
  notes and layouts stay. One that cannot be read is
  left out, not the whole list. One stored without a color (before avatars) takes the least used
  in the list's order (`readable_projects`), which the store writes with the list's next change
  (`leave_out_made_on_reading`), so a project removed leaves the others' colors; a color or
  letters that cannot show count as none, stored as they are. Stored in app data beside the settings; changes run in one
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
  checks the folders again; `edit_project` stores the name and the avatar only (`Avatar::checked`,
  as `writtenLetters` in the projects module). Failures show in the dialog.
- Locate… (`relocate_folder`): the folder resolves as a new project's and replaces the folder's
  place, its id kept; another project's is `FolderChange::InProject`. `watch_on_screen` compares the
  folder's id and place, the frontend reads the folder again (`useReadFolderAgain`).
- Without folder: no folder to name, never routed, watched or summarized. A folder without git is routed and watched, never
  asked for a snapshot, summary, diff or commits.

## Decisions

- One container, the project: not global notes beside projects (two navigations, two
  places for a note); lists are topics inside it, the Inbox the one place outside. Panels come
  from what a project has, never from a template the user picks. One folder first, the model
  shaped for several (VS Code's multi-root workspace) so stored projects change once; several:
  `project-folders.md`.
- Id made once and kept, not made from the location: a project without folder
  has no location, one with several no single one. A folder is one project's, found by place;
  stored ids stay, nothing migrated.
- Locate… onto another project's folder refused, not a merge: it changes a folder
  only.
- Avatar colors given, not from the id's hash: six colors by hash put two projects in one color
  at 4 projects 72% of the time, always from 7. Letters at most two: three only fit the 32 px
  avatar with smaller letters, and not the palette's 24 px; the color tells clones apart, the
  letters written confirm it.
- Kind by its own query, not from the summary: at level 1 the summary comes with the
  snapshot, so reading it first would run `git status` twice.
