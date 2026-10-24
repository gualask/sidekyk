# Projects

Several projects, one on screen: a project is a name, its notes and none or one folder (a
repository, or a folder without git).

## Behaviour

- New project (2026-10-23): the "+ New project" card last at level 0 ("Notes on a topic, and a
  folder if you want") opens one dialog for everyone: Name (focused) and Folder (optional), "None"
  until Choose… picks one; Cancel and Create (disabled while the name is blank), `↵` creates.
  Any folder (2026-10-24): one inside a repository resolves to the repository's root, any other is
  taken as it is; its name fills an empty name. A folder that is another project's is said under
  the field ("Already the project shop", Open: that project shows). Create adds the project last
  and opens it at level 1.
- What a folder is (2026-10-24): a repository when a `.git` (folder, or file for linked worktrees
  and submodules) is at its root, else a folder without git. Found where it is read, never
  stored: `git init` in it, or `.git` removed, changes its panels while the app runs (Changes
  comes and goes, `workspace.md`). A plain folder inside a repository made later stays plain.
- Rename (2026-10-23): from the card's ⋯, the same dialog with the name only. Two projects may
  share a name. Removing a project without folder asks about its notes the same way, without the
  line about the folder.
- `sidekyk <folder>` (the first CLI argument, inside a repository its root) opens its project,
  adding one named after the folder when none follows it. Remove (⋯ on the level 0 card; the
  folder is untouched; asks first about its notes, `notes.md`), switch
  (`[`/`]`, `Esc` to level 0, `⌘K` there). The app starts at level 0, the project shown last
  selected; `sidekyk <folder>` opens its project at level 1 (`workspace.md`).
- A project not on this machine says where it is: `WSL: Ubuntu` before its folder on the level 0
  card and after its name in the top bar (the same repository cloned in Windows and in WSL shows
  as two `shop`s otherwise).
- Level 0 card (2026-10-18), three groups set apart by space:
  - Name, and under it the branch (cut with "…"; ahead/behind stay) after a WSL project's
    `WSL: Ubuntu`; for a folder without git the folder itself, cut at its start. The folder is
    the name's tooltip, which covers the card.
  - Three boxes across the card, each as wide as what it holds plus a share of what is left:
    files changed, lines (`+54 −27`), notes waiting; a value at 16 px over its label. Quiet (muted) at 0, so that
    in the grid the projects at work stand out. Counts kept short (`10k+`, `+999k −999k`): the
    widest three fill 262 of the card's 266 px.
  - A well at the bottom, one height whatever it holds: the week of commits, "No commits in 7
    days", or why the repository cannot be read (moved, distro stopped or gone, no git).
  A project without folder (2026-10-23), or with a folder without git (2026-10-24, its folder
  under the name): boxes "waiting" (open notes) and "done"; in the well "Last change yesterday" (calendar days, `Intl.RelativeTimeFormat`: today, yesterday,
  3 days ago, then weeks, months, years) or "No notes yet". Quiet at 0, as the other boxes.
  Boxes and well on `surface-subtle`, never in the page's color: page, card, box are three
  layers; no border, the surface tells them apart (2026-10-18). No chips, no file list (the detail is one
  zoom away), no least height.
- Week of commits: across the well, a bar per local day, today and the six before (no weekday
  letters: "Last 7 days" says it), as tall as the lines the branch's commits changed that day (to
  the busiest day of that project), green the added at the bottom, red the removed above, a pixel
  between; a day of a few lines still shows both. Over it `Last 7 days +2.9k −1.3k`; tooltip per
  day: `Wed 14 Oct: +1234 −340, 5 commits`. Work not committed is left out: it is in the boxes.
- Facts next to the project's name in the top bar: branch, ahead/behind, changed files and lines
  added/removed in tracked files against HEAD (`1.2k changed +1.2k −340`, exact lines in the
  tooltip), or "clean".
- A moved folder (a repository's or not): problem `repository_missing` ("{name}'s folder was
  moved or deleted") with Locate… (the project follows its folder
  there, keeping its id, name, notes and layout) and Remove. A folder that is another project's is
  not taken: a toast says whose, with Open. Adding a folder a project follows opens that project.

- WSL projects (Windows): a folder of a distro (`\\wsl.localhost\<distro>\…` from the folder
  picker, Locate… or the command line) is read in that distro by Sidekyk's helper, never through
  Windows' view of its files. Its card never starts a stopped distro: "Ubuntu is not running.
  Open the project to start it."; opening it starts the distro and the
  helper ("Starting Ubuntu…" until the first read). The distro gone, no git there, or the helper
  not starting: a problem in the top bar (Remove, Try again).

## How it is built

- Identity: a project is `{ id, name, folders }`, a folder local `{ root }` or WSL
  `{ distro, root }` (`root` a Linux path); none or one repository for now, a list so that
  several folders change nothing stored (`../plans/project-folders.md`). Everything of a project
  (queries, layout, notes, session state, avatar color) is keyed by `id`; what reads its
  repository by its folder (`Project::folder`, `projectFolder`). The id is made once (16 random
  hex digits, `shared/id.rs`, as notes') and kept; the frontend never reads it. Stored as the
  frontend gets it. Read too: `{ id, name, location }` (its id kept) and, before ids,
  `{ name, location }` and `{ root, name }`, whose id is their location's
  (`Location::id_before_made_ids`: the root, or `wsl:<distro>:<root>`), so notes and layouts
  stored then stay theirs. One that cannot be read is left out, not the whole list.
- A folder is one project's: `ProjectList::at` finds a project by folder (`Location::same_place`:
  roots by component, without case on macOS and Windows; a distro without case). Places are
  compared in one file, `modules/projects/place.rs`, for this and for an export inside a project
  (`holds`).
- WSL (`../plans/remote-projects.md`): `Machines` (the core's `infrastructure/machines.rs`) routes a
  project to this machine's `LocalRepositories` or its distro's `AgentRepositories`
  (`WslRepositories`, one helper per distro); every machine is told the window's visibility and the
  projects it keeps, and the ones not on screen to watch nothing, which never starts a helper. A
  helper watching nothing closes 10 min after its last request. A summary checks `wsl.exe --list
  --running --quiet` first when no helper runs there (`distro_stopped`, `distro_missing`; kept 5 s
  for the other cards of the distro); a helper that cannot start, or a `wsl.exe` that does not
  answer, is `helper_failed`, never `distro_missing`, which offers Remove. The frontend turns these,
  `repository_missing` and a WSL project's `git_not_found` into problems (`useProjectFailures`,
  `app/problems.ts`).
- Project list: app data next to the settings. Changes run in one mutation scope, in order; the
  last switch wins.
- Only the project on screen is watched and runs full snapshots (`changes.md`). The others show a
  summary (`load_summary`: status + numstat vs HEAD, new files counted not read), the same numbers
  a snapshot gives; 52 ms on Zed's clone. Read when level 0 shows, and when the window shows again
  on it, only if older than 30 s. Inactive projects' caches expire (`gcTime`).
- Card parts: a panel's summary is shown once per part (`SummaryPart`: `lead`, `facts`, `body`)
  and shows nothing in the parts it has nothing for; Changes fills all three, Notes `facts`, and
  `facts` and `body` for a project without folder or with a folder without git (a `Stat` box
  each, the well a `CardWell`, `shared/ui`), Files `lead` for a folder without git
  (`FilesSummary`). Only the summaries of the project's panels show (`projectTiles`, from the
  folder's kind), each told `repository` (`PanelSummaryProps`). Each module stays on its own, the
  card keeps the order.
- Opening a folder (`resolve_folder`, `modules/folder/open.rs`): the candidate's real path (links
  resolved on Unix, as the watcher reports paths; on Windows as given); the nearest folder at or
  above it with a `.git` is a repository, its root from `git rev-parse --show-toplevel`, or that
  folder when git fails (missing, a broken `.git`); no `.git` found, the folder itself and no git
  runs (on macOS without the Command Line Tools `/usr/bin/git` asks to install them).
- Folder kind (`get_folder_kind(projectId, start)`, `folder::folder_kind`): `repository_missing`
  for a folder gone, else whether `.git` is at the root; no git. The cards ask with `start: false`
  (never starting a distro, `distro_stopped` as the summary), the project opened with `true`, the
  cards' answer its placeholder; a kind that cannot be read counts as a repository, its panels and
  the problems telling why (`useFolderKind`). A change of kind comes from the watcher
  (`RepositoryChange.kind_changed`): the frontend resets the project's queries.
- New project and rename (`ProjectDialog`, lazy): `choose_project_folder` picks a folder and says
  what it is (`FolderChoice`: `Usable { path, name, location }`, `InProject { id, name }`),
  changing nothing; `create_project(name, folder)` checks the path again
  (`folder_at`) and adds the project (`ProjectList::add`: name trimmed, never blank; a folder
  another project follows is refused), then shows it; `rename_project` (`ProjectList::rename`,
  stored only: nothing watched changes). Their failures show in the dialog, still open.
- A project without folder is never routed to a machine, watched or summarized as a repository:
  `Project::repository` is `None`, and a repository command given one is an internal error. A
  folder without git is routed and watched, never summarized: snapshot, summary, diffs and
  commits on it are an internal error, never asked.
- Week of commits (`get_commit_activity`, `load_commit_activity`): `git log --since=@<local
  midnight 6 days ago> --no-merges --shortstat -n 501 HEAD` (`LC_ALL=C`: the line is not
  translated), at most 500 commits and 256 KiB; the frontend sums them by local day
  (`activityDays`). Its query key names HEAD (from the summary) and the first day, outside the
  repository's keys: changes on disk and the window showing leave it alone, another HEAD or
  another day reads it again; its cache expires as the others (`gcTime`). 80 ms on this repository
  (68 commits), 0.5 s on Zed's clone over 129 commits.
- Notes on the card: `notes_summary` (how many wait and are done, the last edit), kept in memory
  once read, until the notes change.
- Locate… (`relocate_project`): the folder picked resolves as a new project's; the project's
  folder becomes it (`relocate`), nothing else changes; the same folder changes nothing. Another
  project's folder: `Relocation::InProject { id, name }`, the list as it was. The id stays, so
  what follows the folder is told: `watch_active` compares the id and the folder, and the frontend
  reads the project's queries again (`useReadProjectAgain`).

## Decisions

- Id made from the location (2026-10-18), then made once and kept (2026-10-22): a project
  without folder has no location, one with several no single one. Every new project gets a new
  id, so a repository added where a moved one was is no collision; one folder is one project's,
  found by place, not by id. Ids stored before stay: nothing is migrated.
- Any folder (2026-10-24, `../plans/project-folders.md`): a folder without git has Files and
  Notes; a folder inside a repository is the repository's root, as before. Kind read by a query of
  its own, not from the summary: at level 1 a repository's summary comes with its snapshot, so a
  summary first would run `git status` twice in a row.
- Locate… onto another project's folder is refused (2026-10-22), not a merge: Locate… changes a
  folder only; joining two projects would be a command of its own (not needed). It used to join
  their notes.

- Not watched (2026-10-13): level 0 reads summaries each time it shows (~65 ms, 0.4 s CPU for ten
  repos). A watcher per project is cheap on FSEvents/Windows but on inotify means one watch per
  folder git does not ignore (`../architecture.md`, Watching); revisit if real-time cards are
  missed.
- On show (2026-10-14) read only what may have changed: the watched project if marked while
  hidden, anything older than 30 s. 30 s because of the review loop (`⌘Tab` every 5-30 s: reading
  ten projects each return is ~140 s CPU/hour, 30 s caps it at ~50 s) while another agent's count
  is at most one turn stale. No debounce on show.
