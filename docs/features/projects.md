# Projects

Several repositories, one on screen.

## Behaviour

- Add (folder picker, `sidekyk <folder>`: the first CLI argument's repository), remove (⋯ on the
  level 0 card; the repository is untouched; asks first about its notes, `notes.md`), switch
  (`[`/`]`, `⌘K`, level 0). At start the project shown last opens.
- A project not on this machine says where it is: `WSL: Ubuntu` before its folder on the level 0
  card and after its name in the top bar (the same repository cloned in Windows and in WSL shows
  as two `shop`s otherwise).
- Level 0 card (2026-10-18), three groups set apart by space:
  - Name, and under it the branch (cut with "…"; ahead/behind stay) after a WSL project's
    `WSL: Ubuntu`. The folder is the name's tooltip, which covers the card.
  - Three boxes across the card, each as wide as what it holds plus a share of what is left:
    files changed, lines (`+54 −27`), notes waiting; a value at 16 px over its label. Quiet (muted) at 0, so that
    in the grid the projects at work stand out. Counts kept short (`10k+`, `+999k −999k`): the
    widest three fill 262 of the card's 266 px.
  - A well at the bottom, one height whatever it holds: the week of commits, "No commits in 7
    days", or why the repository cannot be read (moved, distro stopped or gone, no git).
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
- A moved repository: problem `repository_missing` with Locate… (relinks: notes and layout follow,
  into the project already there if it is one) and Remove.

- WSL projects (Windows): a folder of a distro (`\\wsl.localhost\<distro>\…` from the folder
  picker, Locate… or the command line) is read in that distro by Sidekyk's helper, never through
  Windows' view of its files. Its card never starts a stopped distro: "Ubuntu is not running.
  Open the project to start it."; opening it starts the distro and the
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
  a snapshot gives; 52 ms on Zed's clone. Read when level 0 shows, and when the window shows again
  on it, only if older than 30 s. Inactive projects' caches expire (`gcTime`).
- Card parts: a panel's summary is shown once per part (`SummaryPart`: `lead`, `facts`, `body`)
  and shows nothing in the parts it has nothing for; Changes fills all three, Notes `facts` (a
  `Stat` box each, `shared/ui`). Each module stays on its own, the card keeps the order.
- Week of commits (`get_commit_activity`, `load_commit_activity`): `git log --since=@<local
  midnight 6 days ago> --no-merges --shortstat -n 501 HEAD` (`LC_ALL=C`: the line is not
  translated), at most 500 commits and 256 KiB; the frontend sums them by local day
  (`activityDays`). Its query key names HEAD (from the summary) and the first day, outside the
  repository's keys: changes on disk and the window showing leave it alone, another HEAD or
  another day reads it again; its cache expires as the others (`gcTime`). 80 ms on this repository
  (68 commits), 0.5 s on Zed's clone over 129 commits.
- Notes on the card: `notes_summary` (how many wait), kept in memory once read, until the notes
  change.
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
