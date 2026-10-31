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
  built for one, dropped), agent hooks (not every agent), shell hooks (silent while the agent
  runs), tty access time (unchanged on macOS, none on Windows), window titles (permissions,
  overwritten by agents). Kept in mind: follow the project whose files changed last.
- In the viewer (2026-10-18): several commented hunks copied as a batch; side by side; unchanged
  regions expanded on demand; opening the editor at a line; a setting for context lines.
- From tazly: glass blur (GPU), rich-text editors. Taken: one command bar, `Esc` cancels before
  navigating, notes with copy, `⌥` shortcuts on `e.code`. Open: a `PRODUCT.md`.
- Input from anywhere (2026-10-22): selected text captured in any app (Windows accessibility,
  not terminals), double-tap modifiers (a global keyboard hook), link previews, backgrounds.
- For captures (2026-10-22): an overlay of our own, drawing tools beyond annotations, a board,
  presentation mode.
- An agent's cockpit (2026-10-26): sessions, an editor, browser automation, remote control,
  notification badges, wake lock; whitespace-only files hidden from the list; linked worktrees
  picked in the top bar (2026-10-31: the repository is what is reviewed; an agent's worktree shows
  once merged, a merge commit diffed against its first parent; a worktree can still be a project
  of its own).
- Pasting into the app used before (2026-10-29): a synthetic `⌘V` after hiding needs the
  Accessibility permission on macOS, X11 or opt-in Wayland support on Linux, and fails against
  elevated terminals on Windows (UIPI); a panel anchored to the tray.
- A search launcher (2026-10-29): OCR, semantic search, a query language, dates in natural
  language, a local LLM, a launcher window. MCP clients connected by writing their config: an
  adapter per client.

## Out of scope

- Writing to git or files (stage, commit, revert, edit).
- Running or embedding the agent.
- Replacing the `git` CLI with `gix`/libgit2 while process start is not the measured bottleneck.
