# Changes

What changed in the working tree against HEAD, and the viewer every panel uses for a file.

## Behaviour

- Files grouped as changes, new files, staged, with line counts; `↑`/`↓` or `j`/`k` move. Read
  again when files or refs change on disk; the open diff only when the change touches its file
  (2026-10-21).
- Viewer: "Changes | Full file" (default in settings). Changes: unified diff, notices for binary
  and cut. Full file: the diff with full context, cut into git's three-line hunks (20 ms on a
  13,291-line file).
- Copy with a click (line, hunk, selection) through the user's `{row}`/`{text}` template (default
  `path:lines` and a `diff` block).
- Scrollbar as a map (2026-10-17): a mark per hunk where its changed lines are, in the gutter's
  colors, under a translucent thumb as VS Code's. A mark has 12 px of click room at least
  (overlapping ones join), a click on the track centers there; the map widens under the pointer
  (12→36 px, wide 20→48). `diffScrollbar` narrow (12 px) or wide (20 px). Native scrollbars hidden
  (`scrollbar-width` cannot hide one axis), so a thin horizontal bar of ours shows while lines run
  past the edge.
- Long lines (2026-10-19): scroll sideways (default, as VS Code and Zed) or wrap, setting
  `codeLines`, in every viewer. Wrapped by Zed's rule: before a word after a space or before a
  character not of a word; a longer word cut at the edge; no row starts with a character drawn with
  the one before (accents, joiners, flags); following rows at the line's indentation (none past
  half the row); a copy has no break added. A new width keeps the top row in place.
- `n`/`p` (2026-10-17): next or previous change across the files of the list (or of the commit);
  past the last, the next file opens on its first; a word at either end.
- Recent commits (VS Code's graph, first parents, 50); a commit's files replace the list until
  `×`/`Esc`.
- Find bar: `⌘F` with a file open (a commit's too), empty, matches from the top (`3/12`, `↵`/`⇧↵`,
  `Esc`); `⌘F` in the bar or its icon opens the palette's search in contents with its text. Top
  right as VS Code's find widget; the match read is never under it.
- Syntax colors on both sides: `syntax-colors.md`.

## How it is built

- Snapshot, in parallel: `git status --porcelain=v2 -z --branch --untracked-files=all`, `git diff
  --numstat -z` (unstaged and `--cached`), `git diff HEAD --numstat` for the summary. One in flight
  per project. Untracked files read to count lines (binary: NUL in the first 8 KiB): 4 MiB per
  file, 32 MiB and 2,000 files per snapshot. At most 10,000 changed paths (`truncated`, `10k+`).
- Diff: `git diff [--cached] --no-color --no-ext-diff -U3 -- <path>` (both paths for a staged
  rename, `--no-index /dev/null <path>` for untracked); full file with `-U` at git's maximum. Parsed
  from the first `@@`, so `diff.noprefix` and the like do not matter.
- Commits: `git log -z --first-parent -n 51 HEAD --ignore-missing --no-show-signature`; a commit's
  files `git diff-tree -r -z --raw --numstat -M` against its first parent (`--root` for a root),
  at most 10,000; ids must be hashes (`invalid_commit`).
- Scrollbars (`ScrollMap.tsx`, `scrollbars.ts`): one observer of the scroll element; thumbs and
  marks follow scrolls and resizes without a render; the content's height is the one scale.
  `trackMarks` gives click rooms and joins overlaps. `Pane` owns the layout and the hunk gone to,
  shared by the list and the map.
- Wrapping (`model/soft-wrap.ts`, `ui/code-wrap.ts`): breaks chosen in JS, so every line's height
  is known before it renders and the list keeps fixed-height rows (`diffLayout`). Columns: the
  width less the gutter over the width of `0` (canvas); other characters measured once each per
  session (CJK ~1.5 columns, emoji 2.3 in SF Mono). One `LineWrapper` per column count gives rows
  and breaks; it wraps only lines wider than the row, ASCII ones by a probe at the row's end. A
  break is an empty `.soft-break` whose `::after` is `"\A"` plus the indentation: generated text,
  left out of `Selection.toString()`. Rows are `memo`; a new layout calls the virtualizer's
  `measure()` and puts back the top row.
- Wrapping measured 2026-10-19, files up to 2 MiB: once per text 3-8 ms; per column count under
  1 ms for code and prose, 8-12 ms for 2 MiB of CJK; a screen 1-5 ms wrapped against 1-145 ms on
  one row (WKWebView); the `large` fixture (6.7 MiB) ~28 ms per resize in Chromium.
- `n`/`p`: `HunkReader` steps from the hunk gone to while on screen, else from the line read; past
  either end Changes opens the next or previous file (`openAt`).
- Find bar (`FindBar`, 300 px): works on the target's file until closed; while open the list
  leaves `FIND_BAR_SPACE` above its rows (virtualizer `scrollMargin`, scroll anchoring off) and a
  match under the bar counts as off screen. A commit's file has its own bar.

## Decisions

- Against HEAD, not the default branch or merge base (2026-10-14), as VS Code and Zed.
- Map: marks under a translucent thumb, not strong colors (2026-10-17: too loud); nothing marks the
  change gone to, no tooltip (too much).
- Long lines a setting only, no shortcut (2026-10-19): VS Code's `⌥Z` and Zed's `⌘K Z` are per
  editor. Breaks in JS rather than CSS `pre-wrap`: a height known before rendering keeps the list
  virtualized and the map exact.
