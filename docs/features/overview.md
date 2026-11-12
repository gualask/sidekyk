# Overview

Level 0, all projects: the Inbox on the left (`notes.md`), a row per project beside it. What a
project is: `projects.md`; the levels: `workspace.md`.

## Behaviour

- "Projects" with New project (`projects.md`), then a row per project on the window's
  background, set apart by a line; tinted under the pointer, `⋯` shown then. The project
  on screen has an accent bar on its left edge and the focus as the list opens (`↵` goes back,
  `↑`/`↓` move).
  - The avatar; the name, WSL's tag after it (`wsl.md`; the name is cut, never the tag); the
    folder in the tooltip.
  - Under the name the branch (ahead/behind kept) and the lines not committed in tracked files
    (`+54 −27 uncommitted`, short: `+1.2k`), or `3 changed` when no line is counted (new files, a
    binary); clean, nothing. Without git the folder, cut at its start. A folder that cannot be
    read says why instead, whole in the tooltip.
  - At the end, one width for every row: a repository's week of commits; without git or folder,
    the open notes (`3 open notes`, muted at 0).
- Week of commits: a line 24 px high through today and the six days before, each as high as the
  lines its commits changed (to the busiest day), over a faint area; no number. Under the pointer
  (250 ms) or the focus, a popup: the week's lines, then a row a day, oldest first, its weekday
  (`Wed`), a bar (green then red, to the busiest day) and its lines (`—` without commits). A click
  opens the project. No commits, or none readable: the baseline alone.

## How it is built

- Only the folder on screen of the project on screen is watched (`changes.md`). The rows show a
  summary (`load_summary`: status + numstat vs HEAD, new files counted not read, 52 ms on
  a 4,366-file Rust repository), read when level 0 shows, and on show only if older than 30 s; inactive caches expire
  (`gcTime`).
- Row parts: each panel's summary fills `lead` (under the name) or `end` (`SummaryPart`): Changes
  both, Files `lead` without git (`FilesSummary`), Notes `end` without a repository (open notes,
  `NotesSummary`; `notes.md`). Only the project's panels' summaries show.
- Week of commits (`get_commit_activity`): `git log --since=@<local midnight 6 days ago>
  --no-merges --shortstat -n 501 HEAD`, `LC_ALL=C`, at most 500 commits and 256 KiB, summed by
  local day in the frontend (`activityDays`). Keyed by HEAD and first day, outside the repository's
  keys: changes on disk leave it alone. 80 ms here (68 commits), 0.5 s on a 4,366-file Rust repository (129). The
  line (`model/sparkline.ts`) is a monotone cubic (Steffen's): never under the baseline nor past
  the busiest day.

## Decisions

- Projects not on screen not watched: level 0 reads summaries when it shows (~65 ms,
  0.4 s CPU for ten repositories). A watcher per project is cheap on FSEvents and Windows, but on
  inotify a watch per folder (`../architecture.md`, Watching).
- On show only what may have changed: the project marked while hidden, anything older
  than 30 s. The review loop (`⌘Tab` every 5-30 s) reading ten projects each time is ~140 s CPU an
  hour; 30 s caps it at ~50 s, another agent's count at most one turn stale.
- Rows for projects, cards for notes (the maintainer): projects as cards read as a wall of text,
  two lists alike as one list. Rows on the window's background keep the break between the
  columns with no box per project.
- A row says what the project is, the work not committed and the recent pace (the maintainer).
  The work not committed sits by the branch, said so: beside the week it read as the week's.
- The week as one line, its numbers on demand (the maintainer): the pace reads at a glance; the
  lines a day matter only when looked for, and always shown weigh on every row. Lines only, not
  commits or files.
- Without git, open notes, not activity: a folder's last change means walking its tree at level 0
  (`files.md`: never), seconds for a large one, and the disk keeps only each file's last change.
