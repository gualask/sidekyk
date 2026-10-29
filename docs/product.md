# Product

A desktop companion for watching a coding agent work: what changed in a repository, its files,
notes per project, several projects (2026-10-11: from a changes viewer to a project workspace).

## Guardrails

- Repositories stay read-only; Sidekyk is not an editor.
- The main gesture is one keystroke away: bring the window up, see the changes, copy a hunk.
- The performance golden rule (`AGENTS.md`) applies to every panel.
- Git views behave as VS Code's and Zed's; features hold across agents, terminals, shells and OSes,
  or are not built.

## Layout: semantic zoom

Levels 0 all projects, 1 a project's panels as tiles, 2 one panel full screen
(`features/workspace.md`). A free canvas (React Flow) was rejected: wheel conflicts between pan and
scroll, focus and text in a scaled layer, every panel live when zoomed out. Panels are independent
modules, so a canvas could be another layout later. Approved mock: `.local/mocks/workspace.html`
(local), frozen 2026-10-12; revisions are dated in `features/`.

## Not taken

- Naming the agent at work; "last changed 40 s ago" on cards (no source without watching every
  project).
- Tabs at level 1 (2026-10-13); a rail of projects beside the tiles (2026-10-18, built then
  dropped: `Esc` to the cards is quicker, its counts went stale).
- Long structured notes; a filter in Files; a dot on the tray for hidden changes (2026-10-14).
- Comparing against the default branch or merge base (2026-10-14).
- Following the terminal (2026-10-16): no automatic switch to the project of the terminal used
  last. Every signal breaks on some axis: terminal APIs (an adapter per terminal, blind under tmux;
  built for kitty, dropped), agent hooks (not every agent), shell hooks (silent while the agent
  runs), tty access time (unchanged on macOS, none on Windows), window titles (permissions,
  overwritten by agents). Kept in mind: follow the project whose files changed last.
- In the viewer (2026-10-18): several commented hunks copied as a batch; side by side; unchanged
  regions expanded on demand; opening the editor at a line; a setting for context lines.
- From tazly: glass blur (GPU), rich-text editors. Taken: one command bar, `Esc` cancels before
  navigating, notes with copy, `⌥` shortcuts on `e.code`. Open: a `PRODUCT.md`.
- From Carbon (2026-10-22): selected text captured in any app (Windows accessibility, not
  terminals), double-tap modifiers (a global keyboard hook), link previews, backgrounds. For
  Capture: images pasted or dropped into notes; a small window confirming a capture while hidden,
  destroyed 1.5 s after the last.
- From Shotoshot (2026-10-22, GPL-3.0): its overlay, drawing tools, Board, presentation mode. For
  Capture (`../.cflow/plans/capture.md`): editable annotations, one process per capture.
- From OpenTodo (2026-10-22, AGPL-3.0, ideas only): quick add recognizing dates, `#project`,
  `@label`, priority while typing, its own grammar (6-8 kB gzip against 30-90 kB date libraries);
  entities tinted in the field and a chip under it. For entities in notes
  (`../.cflow/plans/notes-entities.md`). Also: a Markdown vault in sync (`ROADMAP.md`, Later), an
  MCP endpoint for agents (`ROADMAP.md`, Notes).
- From CodeNomad (2026-10-26, MIT; a cockpit for OpenCode that runs the agent, stages, commits
  and edits): sessions, Missions, its editor, browser automation, Remote Control, notification
  badges, wake lock, whitespace-only files hidden from the list. Taken: linked worktrees picked
  in the top bar (`../.cflow/plans/changes.md`), formatting-only changes told in the viewer
  (`features/changes.md`), a changed image's two sides (`../.cflow/plans/previews.md`).
- From Cliptray (2026-10-29, no license; a tray clipboard manager): pasting into the app used
  before (hide, then a synthetic `⌘V`: the Accessibility permission on macOS; `enigo` 0.2 defaults
  to X11 through `xdo`, Wayland and libei are opt-in features; UIPI against elevated terminals on
  Windows; a fixed 70 ms wait), a panel anchored to the tray. Taken: one universal macOS `.dmg`
  (`ROADMAP.md`, Platforms and release).
- From Kensaku (2026-10-29, MIT; a local search launcher: names, text in documents, OCR, meaning,
  MCP): OCR, semantic search, its query language, dates in natural language, a local LLM, a
  launcher window. Taken: events the system dropped read the project again (`architecture.md`,
  Watching). For agents over MCP (`ROADMAP.md`, Notes; its `docs/AGENTS.md`): a stdio server from
  the same binary, read-only; pages with a cursor, snippets capped at 100 characters, a size
  budget in each answer; a file's text returned as data, never as instructions; a `health_check`
  tool; roots checked after resolving `..` and links. Not its one-click connect: it writes each
  client's config, an adapter per client. For text in documents (`ROADMAP.md`, Projects):
  `lopdf` inside `catch_unwind` (it panics on malformed PDFs); `zip` and `quick-xml` reading
  Office's XML as a stream up to a byte cap; a time and a size cap per file; Tantivy, after SQLite
  FTS5 trigram measured at 1M documents (918 MB, 258 ms; our projects are far smaller). Its
  background priority on macOS is `PRIO_DARWIN_PROCESS`, the whole process with its UI
  (`man setpriority`); an indexing thread alone is `PRIO_DARWIN_THREAD`.

## Out of scope

- Writing to git or files (stage, commit, revert, edit).
- Running or embedding the agent.
- Replacing the `git` CLI with `gix`/libgit2 while process start is not the measured bottleneck.
