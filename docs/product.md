# Product

A desktop companion for watching a coding agent work: what changed in a repository, its files,
notes per project, several projects.

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
(local), frozen; revisions are in `features/`.

## Not taken

- Naming the agent at work; "last changed 40 s ago" on the rows (no source without watching every
  project).
- Tabs at level 1; a rail of projects beside the tiles (`Esc` to level 0 is quicker, its
  counts go stale).
- Long structured notes; a filter in Files; a dot on the tray for hidden changes.
- Comparing against the default branch or merge base.
- More references in a note's text: a capture's markers (`A` is a word too, and the
  letters are drawn in the image an agent reads), commit hashes (hex words, and only the recent
  commits to open), `#list` (the quick note has a destination field instead), dates and reminders
  (a task manager; a timer while idle).
- Following the terminal: no automatic switch to the project of the terminal used last. Every
  signal breaks on some axis: terminal APIs (an adapter per terminal, blind under tmux), agent
  hooks (not every agent), shell hooks (silent while the agent runs), tty access time (unchanged
  on macOS, none on Windows), window titles (permissions, overwritten by agents). Kept in mind:
  follow the project whose files changed last.
- In the viewer: several commented hunks copied as a batch; side by side; unchanged
  regions expanded on demand; opening the editor at a line; a setting for context lines.
- Glass blur (GPU), rich-text editors. Open: a `PRODUCT.md`.
- Input from anywhere: selected text captured in any app (Windows accessibility,
  not terminals), double-tap modifiers (a global keyboard hook), link previews, backgrounds.
- For captures: drawing tools beyond annotations, a board, presentation mode (our own
  overlay: `features/capture.md`).
- An agent's cockpit: sessions, an editor, browser automation, remote control,
  notification badges, wake lock; whitespace-only files hidden from the list; linked worktrees
  picked in the top bar (the repository is what is reviewed; an agent's worktree shows
  once merged, a merge commit diffed against its first parent; a worktree can still be a project
  of its own).
- Pasting into the app used before: a synthetic `⌘V` after hiding needs the
  Accessibility permission on macOS, X11 or opt-in Wayland support on Linux, and fails against
  elevated terminals on Windows (UIPI); a panel anchored to the tray.
- A search launcher: OCR, semantic search, a query language, dates in natural
  language, a local LLM, a launcher window. MCP clients connected by writing their config: an
  adapter per client.

## Out of scope

- Writing to git or files (stage, commit, revert, edit).
- Running or embedding the agent.
- Replacing the `git` CLI with `gix`/libgit2 while process start is not the measured bottleneck.
