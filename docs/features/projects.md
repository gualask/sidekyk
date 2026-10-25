# Projects

A project is a name, its notes and none or one folder: a repository, or a folder without git.
Several projects, one on screen.

## Behaviour

- New project (2026-10-23): the last card at level 0 opens one dialog for everyone: Name and
  Folder (optional; "None" until Choose…), Create disabled while the name is blank. A folder inside
  a repository becomes the repository's root, any other is taken as it is (2026-10-24); its name
  fills an empty name. Another project's folder is said under the field, with Open. Create opens
  the new project at level 1.
- Rename from the card's ⋯, the same dialog with the name only; two projects may share a name.
  Remove from the card's ⋯: the folder is untouched, the notes are exported or deleted first
  (`notes.md`).
- `sidekyk <folder>` opens the project of that folder, adding one named after it if none.
- What a folder is (2026-10-24): a repository when a `.git` (folder, or file for worktrees and
  submodules) is at its root, else a folder without git. Never stored: `git init` or `.git`
  removed changes the panels while the app runs (`workspace.md`).
- Level 0 card, three groups set apart by space, on `surface-subtle` (no border, 2026-10-18):
  - name and under it the branch (ahead/behind kept), or for a folder without git the folder, cut
    at its start; WSL's tag first (`wsl.md`); the folder in the tooltip;
  - three boxes: files changed, lines (`+54 −27`), notes waiting; muted at 0, so projects at work
    stand out; counts kept short (`10k+`, `+999k −999k`) to fit 266 px;
  - a well of one height: the week of commits, "No commits in 7 days", or why the folder cannot
    be read.
  Without folder or without git: boxes "waiting" and "done", the well "Last change yesterday"
  (`Intl.RelativeTimeFormat`) or "No notes yet".
- Week of commits: a bar per local day, today and the six before, as tall as the lines changed that
  day (scaled to the project's busiest), added green below, removed red above; `Last 7 days +2.9k
  −1.3k` over it, a tooltip per day. Work not committed is in the boxes.
- Top bar facts: branch, ahead/behind, changed files and lines against HEAD (`1.2k changed +1.2k
  −340`), or "clean".
- A folder moved or deleted: problem `repository_missing` with Locate… (the project follows the
  folder, keeping id, name, notes and layout) and Remove. Another project's folder is refused with
  a toast and Open.

## How it is built

- Identity: `{ id, name, folders }`, a folder local `{ root }` or WSL `{ distro, root }`; one folder
  for now, a list so several change nothing stored. Everything of a project (queries, layout,
  notes, session state, avatar color) is keyed by `id`, made once (16 random hex digits,
  `shared/id.rs`), never read by the frontend. Older stored forms are read: `{ id, name, location
  }`, and before ids `{ name, location }` and `{ root, name }`, whose id is their location
  (`Location::id_before_made_ids`), so their notes and layouts stay. One that cannot be read is
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
  else whether `.git` is at the root. One query for cards and level 1 (`useFolderKind`); a kind that
  cannot be read counts as a repository, its panels and problems telling why. A change of kind
  comes from the watcher (`kind_changed`) and resets the project's queries.
- Dialog (`ProjectDialog`, lazy): `choose_project_folder` picks a folder and says what it is
  (`FolderChoice`: `Usable { path, name, location }`, `InProject { id, name }`), changing nothing;
  `create_project` checks the folder again; `rename_project` stores only. Failures show in the
  dialog.
- Locate… (`relocate_project`): the folder resolves as a new project's and replaces the project's;
  another project's is `Relocation::InProject`. `watch_active` compares id and folder, the
  frontend reads the project again (`useReadProjectAgain`).
- Without folder: `Project::repository` is `None`, never routed, watched or summarized; a
  repository command on it is an internal error. A folder without git is routed and watched, never
  asked for a snapshot, summary, diff or commits.
- Only the project on screen is watched (`changes.md`). The others show a summary (`load_summary`:
  status + numstat vs HEAD, new files counted not read, 52 ms on Zed's clone), read when level 0
  shows, and on show only if older than 30 s; inactive caches expire (`gcTime`).
- Card parts: each panel's summary fills `lead`, `facts` or `body` (`SummaryPart`); Changes all
  three, Notes `facts` (and `body` when `repository` is false, `PanelSummaryProps`), Files `lead`
  for a folder without git (`FilesSummary`). Only the project's panels' summaries show.
- Week of commits (`get_commit_activity`): `git log --since=@<local midnight 6 days ago>
  --no-merges --shortstat -n 501 HEAD`, `LC_ALL=C`, at most 500 commits and 256 KiB, summed by
  local day in the frontend (`activityDays`). Keyed by HEAD and first day, outside the repository's
  keys: changes on disk leave it alone. 80 ms here (68 commits), 0.5 s on Zed's clone (129).

## Decisions

- One container, the project (2026-10-22): not global notes beside projects (two navigations, two
  places for a note); lists are topics inside it, the Inbox the one place outside. Panels come
  from what a project has, never from a template the user picks. One folder first, the model
  shaped for several (VS Code's multi-root workspace) so stored projects change once.
- Id made once and kept (2026-10-22; made from the location 2026-10-18): a project without folder
  has no location, one with several no single one. A folder is one project's, found by place;
  stored ids stay, nothing migrated.
- Locate… onto another project's folder refused (2026-10-22), not a merge: it changes a folder
  only.
- Kind by its own query, not from the summary (2026-10-24): at level 1 the summary comes with the
  snapshot, so reading it first would run `git status` twice.
- Projects not on screen not watched (2026-10-13): level 0 reads summaries when it shows (~65 ms,
  0.4 s CPU for ten repositories). A watcher per project is cheap on FSEvents and Windows, but on
  inotify a watch per folder (`../architecture.md`, Watching).
- On show only what may have changed (2026-10-14): the project marked while hidden, anything older
  than 30 s. The review loop (`⌘Tab` every 5-30 s) reading ten projects each time is ~140 s CPU an
  hour; 30 s caps it at ~50 s, another agent's count at most one turn stale.
