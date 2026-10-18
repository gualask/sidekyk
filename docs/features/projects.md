# Projects

Several repositories, one on screen.

## Behaviour

- Add (folder picker, `sidekyk <folder>`: the first CLI argument's repository), remove (⋯ on the
  level 0 card; the repository is untouched; asks first about its notes, `notes.md`), switch
  (rail, `[`/`]`, `⌘K`). At start the project shown last opens.
- Rail: an avatar per project with its change count.
- Level 0 card: branch, changed files with counts and the first three, waiting notes with the
  newest.
- Facts next to the project's name: branch, ahead/behind, changed files and lines added/removed in
  tracked files against HEAD, or "clean".
- A moved repository: problem `repository_missing` with Locate… (relinks: notes and layout follow,
  into the project already there if it is one) and Remove.

## How it is built

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

- Not watched (2026-10-13): level 0 reads summaries each time it shows (~65 ms, 0.4 s CPU for ten
  repos). A watcher per project is cheap on FSEvents/Windows but on inotify means one watch per
  directory (~33,000 for those repos); revisit if real-time cards are missed.
- On show (2026-10-14) read only what may have changed: the watched project if marked while
  hidden, anything older than 30 s. 30 s because of the review loop (`⌘Tab` every 5-30 s: reading
  ten projects each return is ~140 s CPU/hour, 30 s caps it at ~50 s) while another agent's count
  is at most one turn stale. No debounce on show.
