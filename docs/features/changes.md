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
- Long lines (2026-10-19): scroll sideways (default, as VS Code and Zed) or wrap at the viewer's
  edge, setting `codeLines`, in every viewer (diffs, whole files, Files); no shortcut. Wrapped:
  breaks before a word after a space or before a character not of a word (Zed's rule), a word
  longer than the row cut at the edge; spaces hang past the edge, and no row starts with a
  character drawn with the one before (an accent, a skin tone, what a joiner joins, a flag's
  second half); rows after the first at the line's indentation (none when it is over half the
  row); the number on the first row, the gutter and the diff's colors along all of them; a copy of
  a selection has no break added. A width change, or the setting switched, keeps the row at the
  top where it is; the find bar brings the match's own row on screen; the lines left above a hunk
  opened on are lines, however they wrap.
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
- Summary: changed paths counted once each, lines of tracked files only.
- At most 10,000 changed paths (`truncated`: "too many changes", counts read `10k+`).

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
- Wrapping (`model/soft-wrap.ts`, `ui/code-wrap.ts`): breaks chosen in JS, not by the browser,
  so every line's height is known before it renders and the virtualized list keeps fixed-height
  rows (`LINE_ROW_HEIGHT` × rows; `diffLayout(rows, linesOf)`, `heightOf`). Columns: the scroll
  element's width less the gutter, over the width of `0` in the lines' font (canvas); other
  characters measured on a canvas once each per session (CJK ~1.5 columns, emoji 2.3 in SF Mono:
  a table of 1 and 2 would be wrong), read in a layout effect before the first frame shows.
  `measureLines` once per text (each line's one-row width, whether it is printable ASCII); a new
  column count makes one `LineWrapper`, the only source of the rows a line takes (`rowsOf`, the
  layout) and where it breaks (`breaksOf`, the rows on screen): it wraps again only the lines
  wider than the row, ASCII ones by one probe at the row's end and a step back to the last break
  (`wrapAscii`, same breaks as `wrapAny`, tested). `lineWidth` (one `advance` per character, tab
  stops included) also gives the widest line while lines scroll. A break is an empty `.soft-break` whose `::after` is `"\A"` and
  the indentation (`data-indent`): generated text, left out of `Selection.toString()` in WebKit
  and Chromium. The scroll element is `overflow-x: hidden` while wrapping. Rows are `memo`: a
  scroll renders only the rows coming on screen, a new width only the wrapped ones (the lines that
  fit share one `LineBreaks`). A new layout calls the virtualizer's `measure()` and puts back the
  row that was at the top, from `scrollTop` as last scrolled (a shorter list has already pulled it
  back by then).
- Wrapping, measured 2026-10-19 on files up to the 2 MiB limit: once per text 3-8 ms; per new
  column count under 1 ms for code and prose, 1 ms minified, 8-12 ms 2 MiB of CJK; one screen
  renders in 1-5 ms wrapped against 1-145 ms on one row (WKWebView; the long rows of a minified
  file cost the most unwrapped). In Chromium (production build) the `large` fixture, 6.7 MiB of
  lines with 120-character words, costs about 28 ms per window resize, none over 50 ms.
- `n`/`p` (`Pane` with `onPastEnd`, Changes only): `DiffList`'s `HunkReader` steps from the hunk
  gone to while on screen, else from the line read (`hunkStepped`); past either end Changes opens
  the next or previous file (`openAt`, `-1` the last hunk), or says it is the last.
- Find bar (`FindBar`, 300 px, by the map): targets (`fileTarget`) carry the path, the hunk to open
  on and a text to find from a line; the bar works on that file only, until closed (`Esc` closes
  it first). While open the list leaves `FIND_BAR_SPACE` above its rows (virtualizer
  `scrollMargin`, scroll kept steady, browser scroll anchoring off) and a match under the bar
  counts as off screen (`shownWhole`). `⌘F` over a viewer (`Pane`, capture) opens its bar empty
  from the top, or comes back to it; in the bar's field `FindBar` takes it, as its icon, and calls
  `PanelProps.findInFiles`. A commit's file has its own bar (`useCommitFileFind`); opening a
  commit closes the working tree's (`useFileFind().close`).

## Decisions

- Compared against HEAD, not the default branch or merge base (2026-10-14), as VS Code and Zed.
- Map: the marks under a translucent thumb, not strong colors (2026-10-17: too loud); nothing marks
  the change gone to, on the map or by the rows, and no tooltip (2026-10-17: too much).
- Long lines (2026-10-19): a setting only, no shortcut (VS Code's `⌥Z` and Zed's `⌘K Z` are per
  editor; the maintainer wants it on or off from the settings). Breaks chosen in JS rather than by
  CSS `pre-wrap`: a height known before rendering keeps the list virtualized and the map exact,
  where measured rows would shift as they render.
