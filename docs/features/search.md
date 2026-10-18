# Search

The palette is the only search; panels have no filter.

## Behaviour

- `⌘K` by name: projects, panels, the project's files, note lists and notes. `⌘F` in the project's
  files' contents, its open file first. `⌘K`/`⌘F` switch mode inside the palette, text kept. With a
  file open `⌘F` opens its find bar first (`changes.md`).
- By name: every file of the project on screen (the tree plus deleted files), never other
  projects' files (switching project is searching its name), none at level 0. A change is marked
  by a quiet word, not a colored name. `↵` goes through the shared selection (`files.md`).
- Notes: lists and notes before files; `↵` opens Notes at the same zoom on the list, the note
  scrolled to and lit up (a done one's group unfolded), its tile back from the top bar if
  minimized.
- In contents: results streamed, the file shown first; `↵` opens the file with the find bar at the
  line.

## How it is built

- `search` runs at every key: projects, panel titles (sent by the frontend) and, once something is
  typed, the files of the project the request names: the cached tree (read if missing) plus
  deleted files, each marked from the last snapshot (modified > added > deleted). Words match
  independently, case ignored; matched letters return as UTF-16 offsets; at most 500 files, the
  best picked without sorting the rest. From 20,000 paths scoring runs on up to 8 threads (Zed's
  4,366: 0.37 ms, 0.34 ms when the palette ranked changed files only; 200,000 synthetic:
  80 → 14 ms).
- Notes (`modules/search/notes.rs`, ranked where `NotesStore` keeps them, no copy; read first if
  not in memory; only a project of the list): lists by name; notes by first line (fuzzy), else by
  the text typed anywhere in them (substring, case ignored, 2 characters at least) with the part
  around it on one line; open before done, at most 50. 1,000 notes: 3.5 ms a key. Target:
  `notesTarget`.
- `search_contents` (`modules/search/contents.rs`, `grep-searcher`): the tree's files through
  `open_file` (never through a link, no git), up to 8 threads taking the next file, a fixed buffer
  each, binary skipped at the first NUL, UTF-16 by BOM, the first 2 MiB per file (what the viewer
  shows). Literal, smart case, at least 2 characters; stops at 2,000 lines; long lines cut to 300
  characters around the first match. Files go through a `Channel` in batches every 50 ms. Each
  search counts a run: a newer one (or `stop_content_search`) stops it. A complete search is kept
  so a longer text (`narrows`) reads only the files it found, in the same tree; any watcher batch
  drops it. 43-50 ms on Zed's clone, ~5 MB.
- Frontend: `useContentSearch` waits 150 ms after typing, keeps results until the next text's
  first files.

## Decisions

- One key for "find" (2026-10-17) rather than an editor's in-file `⌘F` plus project `⌘⇧F`; the find
  bar over the viewer covers the in-file case.
- In contents, in-process over a file list, not `git grep`, so it also serves folders without git
  and notes. `grep-searcher` + `grep-regex` chosen over our own loop on `regex` + `memchr`: same
  time and CPU on Zed's clone (36-41 ms, ~0.28 s CPU on 8 threads; the cost is reading files),
  4.7-5.8 MB peak against 20-25 MB (whole files in memory), and other encodings. Hence: narrowing,
  a line limit, a typing pause.
- Fuzzy matching (2026-10-13): `nucleo-matcher` 0.3 in Rust (fzf scoring, path mode, MPL-2.0 per
  file: unmodified in an MIT app, notice shipped; +199 KiB binary). Zed, nushell, Rerun use it.
  Alternatives: `frizbee` (faster, MIT, but monthly breaking releases, no path mode),
  `fuzzy-matcher` (unmaintained). Speed does not decide; ranking and a stable API do. Behind
  `modules/search/rank.rs`.
