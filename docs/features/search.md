# Search

The palette is the only search; panels have no filter.

## Behaviour

- `⌘K` by name: in a project its panels, files, lists and notes; at level 0 the projects and the
  lists and notes of every project and of the Inbox (2026-10-24), no files. `⌘F` in the
  project's files' contents, its open file first; with a file open `⌘F` opens its find bar first
  (`changes.md`). `⌘K`/`⌘F` switch mode inside the palette, keeping the text.
- Nothing typed: where to go (Projects, or Panels in a project). Typed: one list by score, no
  titles (2026-10-21), the best 2 of each kind first so no kind hides another; equal scores:
  project, panel or list, then file, then note. Every row starts with the icon of what it opens. A
  project shows its folder under its name and its machine's tag (`wsl.md`), as Zed's recent
  projects.
- Files: every file of the project on screen (the tree plus deleted files), a change marked by a
  quiet word; `↵` through the shared selection (`files.md`).
- Notes by the words typed, anywhere in them (2026-10-21: letters scattered over a sentence matched
  almost any note). `↵` opens Notes on the list, the note scrolled to and lit up, a done one's group
  unfolded, its tile back from the top bar.
- At level 0: a note's row says "{list} in {project}" or "Inbox", a list's its project. At most 50
  notes, the best of every book; equal scores open before done, then the Inbox's, then the
  projects' in the cards' order. `↵` on a project's note or list opens that project at level 1 on
  Notes, starting no distro; on an Inbox note level 0 stays and its column scrolls to it.
- In contents: results streamed, the open file first; `↵` opens the file with the find bar at the
  line.

## How it is built

- `search` runs at every key: panel titles (sent by the frontend) and, once something is typed,
  the files of the project named, or the projects when none is. Files: the cached tree plus
  deleted files, marked from the last snapshot. Words match independently, case ignored; matched
  letters as UTF-16 offsets; at most 500 files, the best picked without sorting the rest; from
  20,000 paths on up to 8 threads (Zed's 4,366 paths 0.37 ms; 200,000 synthetic 80 → 14 ms).
  Names score fuzzy (`nucleo` default), paths and notes in path mode; for one word a list or
  panel ranks over a file over a note (`rank.rs` test). `palette-rows.ts` mixes kinds by score.
- Notes (`modules/search/notes.rs`): ranked where `NotesStore` keeps them, no copy. Lists by name
  (fuzzy); notes holding every word (substring atoms, case and accents ignored, 2 characters at
  least), shown by their first line when it holds them all, else by the part around the first
  word; at most 50. At level 0, `with_every_book` and `search_every_book`: each book's best 50
  merged, the Inbox's list left out, each match naming its `book`.
- Level 0 in the frontend: `paletteRows` names books by `PaletteBook`; `openNotes(book, list,
  note)` sends an Inbox note to `InboxColumn` (`reveal`), or activates the project and keeps the
  target until its panels show (`useWaitingAsked`).
- `rank_names` (2026-10-23): plain names ranked as the palette's projects, for the Move dialog
  (`notes.md`).
- `search_contents` (`modules/search/contents.rs`, `grep-searcher`): the tree's files through
  `open_file` (no links, no git), up to 8 threads, binary skipped at the first NUL, UTF-16 by BOM,
  the first 2 MiB per file. Literal, smart case, 2 characters at least, 2,000 lines at most, long
  lines cut to 300 characters around the match. Batches every 50 ms through a `Channel`; a newer
  search (or `stop_content_search`) stops the older. A complete search is kept so a longer text
  reads only the files it found; any watcher batch drops it. The frontend waits 150 ms after
  typing.
- Measured (release): notes, 1,000 of ~470 characters, 0.07-0.42 ms a key; every book at level 0,
  worst case (almost every note matching), 1,000 / 9,000 / 30,000 notes 1.5-2.7 / 6-13 / 17-38 ms,
  nothing found 0.1 / 1.1 / 4.8 ms (2026-10-24); contents 43-50 ms on Zed's clone, ~5 MB.

## Decisions

- One key for "find" (2026-10-17) rather than `⌘F` in a file plus `⌘⇧F` in the project; the find bar
  covers the file.
- In contents, in-process over a file list, not `git grep`: it serves folders without git and
  notes too. `grep-searcher` + `grep-regex` over our own loop on `regex` + `memchr`: the same time
  on Zed's clone (36-41 ms, ~0.28 s CPU on 8 threads; the cost is reading files), 4.7-5.8 MB peak
  against 20-25 MB, other encodings.
- Fuzzy matching (2026-10-13): `nucleo-matcher` 0.3 (fzf scoring, path mode; MPL-2.0 per file,
  unmodified, notice shipped), used by Zed, nushell, Rerun. Not `frizbee` (monthly breaking
  releases, no path mode) nor `fuzzy-matcher` (unmaintained). Ranking and a stable API decide, not
  speed.
- Notes at level 0 without an index or threads (2026-10-24): the times above; revisited on a
  measured need.
