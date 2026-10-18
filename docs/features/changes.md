# Changes

What changed in the working tree against HEAD, and the viewer every panel uses for a file.

## Behaviour

- File list grouped as changes / new files / staged, with line counts; `↑`/`↓` or `j`/`k` move
  between files. Refreshed when files or refs change on disk (watcher, `../architecture.md`).
- Viewer: "Changes | Full file" (default in settings). Changes: unified diff, binary and cut
  notices. Full file: the diff with full context, cut into git's three-line hunks (20 ms on a
  13,291-line file).
- Copy with a click in both views (line, hunk, selection) through the user's `{row}`/`{text}`
  template (default: `path:lines` plus a `diff` block).
- Scrollbar as a map of the changes (2026-10-17): a mark per hunk where its changed lines are
  (added, deleted, both; the diff's gutter colors), full width, under a translucent thumb as VS
  Code's that drags. A mark has 12 px of click room at least (overlapping ones join), also under
  the thumb (a click on it goes to the mark below); a click on the track centers there. The map
  widens under the pointer (12→36 px, wide 20→48) over the rows; `diffScrollbar` narrow (12 px)
  or wide (20 px). Native scrollbars hidden in the viewer on every engine (`scrollbar-width`
  cannot hide one axis only), so a thin horizontal bar of ours shows while lines run past the
  edge.
- `n`/`p` (2026-10-17): next/previous change across the files of the list (or of the commit
  viewed); the first `n` on a file goes to its first change; past the last, the next file opens on
  its first (`p`: the previous on its last); a word at either end. Steps go on from the change
  gone to while on screen.
- Recent commits (VS Code's graph, first parents, 50); a commit's files replace the list until
  `×`/`Esc`.
- Find bar: `⌘F` with a file open (a commit's file too) opens it on that file, empty, matches from
  the top (`3/12`, `↵`/`⇧↵`, `Esc`); `⌘F` in the bar, or its icon, opens the palette's search in
  contents with its text (`search.md`). It floats top right as VS Code's find widget, with room
  left above the rows, and the match being read is never under it.
- Syntax colors on both sides of a diff: `syntax-colors.md`.

## How it is built

### Snapshot

- In parallel: `git status --porcelain=v2 -z --branch --untracked-files=all`, `git diff
  --numstat -z` (unstaged and `--cached`), `git diff HEAD --numstat` for the summary (staged +
  unstaged before the first commit). One snapshot in flight per project.
- Untracked files are read to count lines (binary: NUL in the first 8 KiB): 4 MiB per file, 32 MiB
  and 2,000 files per snapshot.
- Summary: one entry per path (first three listed), lines of tracked files only.
- At most 10,000 changed paths (`truncated`: "too many changes", counts read `10000+`).

### Diffs and commits

- `git diff [--cached] --no-color --no-ext-diff -U3 -- <path>` (both paths for a staged rename;
  `--no-index /dev/null <path>` for untracked); `wholeFile` uses `-U` at git's maximum. The
  frontend parses from the first `@@`, so `diff.noprefix` and the like do not matter.
- Recent commits: `git log -z --first-parent -n 51 HEAD --ignore-missing --no-show-signature`.
  A commit's files: `git diff-tree -r -z --raw --numstat -M` against its first parent (`--root`
  for a root commit), at most 10,000; ids must be hashes (`invalid_commit`).

### Viewer

- Scrollbars are ours (`ScrollMap.tsx`, kept by `useScrollbars` in `scrollbars.ts`: one observer
  of the scroll element; thumbs follow scrolls with no render; the content's height is the one
  scale of marks and thumb): `ChangeMap` beside the rows (`changeMarks` per hunk; `trackMarks`
  gives each a click room of 12 px at least and joins those whose rooms overlap; a click on the
  thumb that does not drag goes to the mark under it; thumb and marks follow scrolls and content
  resizes with no render, `observeContent`) and `SideScrollbar` below them while lines run past
  the edge. `Pane` owns the layout and the hunk gone to (`stepped`, else the one opened on),
  shared by the list and the map.
- `n`/`p` (`Pane` with `onPastEnd`, Changes only): `DiffList`'s `HunkReader` steps from the hunk
  gone to while on screen, else from the line read (`hunkStepped`); past either end Changes opens
  the next or previous file (`openAt`, `-1` the last hunk), or says it is the last.
- Find bar (`FindBar`, 300 px, by the map): targets (`fileTarget`) carry the path, the hunk to open
  on and a text to find from a line; the bar works on that file only, until closed (`Esc` closes
  it first). While open the list leaves `FIND_BAR_SPACE` above its rows (virtualizer
  `scrollMargin`, scroll kept steady, browser scroll anchoring off) and a match under the bar
  counts as off screen (`rowWithin`). `⌘F` over a viewer (`Pane`, capture) opens its bar empty
  from the top, or comes back to it; in the bar's field `FindBar` takes it, as its icon, and calls
  `PanelProps.findInFiles`. A commit's file has its own bar (`useCommitFileFind`); opening a
  commit closes the working tree's (`useFileFind().close`).

## Decisions

- Compared against HEAD, not the default branch or merge base (2026-10-14), as VS Code and Zed.
- Map: the marks under a translucent thumb, not strong colors (2026-10-17: too loud); nothing marks
  the change gone to, on the map or by the rows, and no tooltip (2026-10-17: too much).
