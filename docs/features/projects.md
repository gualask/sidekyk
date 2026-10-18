# Projects

Several repositories, one on screen.

## Behaviour

- Add (folder picker, `sidekyk <folder>`: the first CLI argument's repository), remove (⋯ on the
  level 0 card; the repository is untouched; asks first about its notes, `notes.md`), switch
  (rail, `[`/`]`, `⌘K`). At start the project shown last opens.
- Rail: an avatar per project with its change count; its tooltip names a WSL project's distro,
  `shop (WSL: Ubuntu)`.
- A project not on this machine says where it is: `WSL: Ubuntu` before its folder on the level 0
  card and after its name in the top bar (the same repository cloned in Windows and in WSL shows
  as two `shop`s otherwise).
- Level 0 card: branch, changed files with counts and the first three, waiting notes with the
  newest.
- Facts next to the project's name: branch, ahead/behind, changed files and lines added/removed in
  tracked files against HEAD, or "clean".
- A moved repository: problem `repository_missing` with Locate… (relinks: notes and layout follow,
  into the project already there if it is one) and Remove.

- WSL projects (Windows): a folder of a distro (`\\wsl.localhost\<distro>\…` from the folder
  picker, Locate… or the command line) is read in that distro by Sidekyk's helper, never through
  Windows' view of its files. Its card never starts a stopped distro: a `stopped` chip and
  "Ubuntu is not running. Open the project to start it."; opening it starts the distro and the
  helper ("Starting Ubuntu…" until the first read). The distro gone, no git there, or the helper
  not starting: a problem in the top bar (Remove, Try again).

## How it is built

- Identity: a project is `{ id, name, location }`, `location` local `{ root }` or WSL
  `{ distro, root }` (`root` a Linux path). Everything of a project (queries, layout, notes,
  session state, avatar color) is keyed by `id`; what reads its repository by `location`.
  `Location::id` makes the id: a local project's is its root, a WSL one's `wsl:<distro>:<root>`;
  the frontend never reads it. Stored as the frontend gets it; on reading the id is made again
  from the location, an entry stored before ids (`{ root, name }`) is a local project, and one
  that cannot be read is left out, not the whole list.
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
  a snapshot gives; 52 ms on Zed's clone. Read after the first paint, when the window shows again
  and when level 0 shows, only if older than 30 s. Inactive projects' caches expire (`gcTime`).
- Notes on the card: `notes_summary`, kept in memory once read, until the notes change.
- Locate… (`relocate_project`): the folder picked resolves to its repository; the notes follow
  first (`notes.md`), then the list (`relocate`: same place, layout, on screen). The same folder
  changes nothing.

## Decisions

- Id made from the location (2026-10-18), not random: two projects in one place share it, and
  Locate… keeps working as before (new place, new id: notes and layout move with it). A random
  id kept across Locate… would collide with a repository added later where the old one was,
  unless every new project got a random id too. VS Code names a WSL folder the same way,
  `vscode-remote://wsl+<distro>/<path>` (`../plans/remote-projects.md`).

- Not watched (2026-10-13): level 0 reads summaries each time it shows (~65 ms, 0.4 s CPU for ten
  repos). A watcher per project is cheap on FSEvents/Windows but on inotify means one watch per
  directory (~33,000 for those repos); revisit if real-time cards are missed.
- On show (2026-10-14) read only what may have changed: the watched project if marked while
  hidden, anything older than 30 s. 30 s because of the review loop (`⌘Tab` every 5-30 s: reading
  ten projects each return is ~140 s CPU/hour, 30 s caps it at ~50 s) while another agent's count
  is at most one turn stale. No debounce on show.
