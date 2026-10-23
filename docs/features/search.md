# Search

The palette is the only search; panels have no filter.

## Behaviour

- `⌘K` by name: in a project its panels, files, note lists and notes; at level 0 the projects
  (2026-10-21: inside a project one leaves by `Esc` or `[`/`]`, a project row there was noise).
  `⌘F` in the project's files' contents, its open file first. `⌘K`/`⌘F` switch mode inside the palette, text kept. With a
  file open `⌘F` opens its find bar first (`changes.md`).
- Nothing typed: where to go under its title (Projects, or Panels in the project). Typed: one list
  by score, no titles (2026-10-21), the best 2 of each kind first so a kind found by the dozen
  hides no other, `↵` on the best; equal scores: panel or list, then file, then note. Every row
  starts with an icon of what it opens: project, panel (its tile's), file, list, note. A project shows its folder under its name (cut at
  the start when long), and its machine's tag when not this one (`WSL: Ubuntu`), as in the top bar:
  a local and a WSL clone of one name are told apart. As Zed's recent projects (name, paths under).
- By name: every file of the project on screen (the tree plus deleted files), never other
  projects' files (another project's: zoom out first), none at level 0. A change is marked
  by a quiet word, not a colored name. `↵` goes through the shared selection (`files.md`).
- Notes by the words typed, anywhere in them, not by letters scattered over a sentence (which
  matched almost any note); its row says its list, not whether it is done (2026-10-21: opening
  unfolds a done one's group anyway, open ones come first on equal scores); `↵` opens Notes at the same zoom on the list, the note
  scrolled to and lit up (a done one's group unfolded), its tile back from the top bar if
  minimized.
- In contents: results streamed, the file shown first; `↵` opens the file with the find bar at the
  line.

## How it is built

- `search` runs at every key: panel titles (sent by the frontend) and, once something is typed,
  the files of the project the request names, or the projects when it names none: the cached tree (read if missing) plus
  deleted files, each marked from the last snapshot (modified > added > deleted). Words match
  independently, case ignored; matched letters return as UTF-16 offsets; at most 500 files, the
  best picked without sorting the rest. From 20,000 paths scoring runs on up to 8 threads (Zed's
  4,366: 0.37 ms, 0.34 ms when the palette ranked changed files only; 200,000 synthetic:
  80 → 14 ms). Each match carries its score; `palette-rows.ts` mixes the kinds by it. Names
  score fuzzy (`nucleo` default), paths and notes in path mode, whose word starts weigh a little
  less: for one word, a list or panel ranks over a file over a note (`rank.rs` test, measured on
  `seed`, `watcher`, `arch`, `mod`, `note`, `rel`).
- Notes (`modules/search/notes.rs`, ranked where `NotesStore` keeps them, no copy; read first if
  not in memory; only a project of the list): lists by name (fuzzy); notes holding every word
  (`nucleo` substring atoms, case and accents ignored, 2 characters at least), shown by their
  first line when it holds them all, else by the part around the first word on one line; best
  first, equal ones open before done, at most 50. 1,000 notes of ~470 characters, release:
  0.07-0.42 ms a key (before, fuzzy first lines then a substring scan: 0.3-2.4 ms). Target:
  `notesTarget`.
- `rank_names` (2026-10-23): names handed over, ranked as the palette's projects, best first by
  index (all in order with nothing typed): the Move dialog's books and lists (`notes.md`), through
  the search port's `rankNames`, which the app hands Notes (`MoveTargets`).
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
