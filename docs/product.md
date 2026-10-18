# Product

A desktop companion for watching a coding agent work: see what changed in a repository, explore
it, take notes per project, switch between projects (several agents, several repositories).
Direction agreed 2026-10-11, from a changes viewer to a project workspace.

## Guardrails

- Repositories stay read-only; editing happens in the editor. Sidekyk is not an editor.
- The main gesture stays one keystroke away: bring the window up, see the changes, copy a hunk.
- The performance golden rule (`AGENTS.md`) applies to every panel.
- Git views behave as VS Code's and Zed's; features hold across agents, terminals, shells and
  OSes, or are not built.

## Layout: semantic zoom

Levels: 0 all projects (cards, doubling as the switcher), 1 a project's panels as tiles, 2 one
panel full screen (`features/workspace.md`). A free canvas (React Flow) was rejected: wheel
conflicts between pan and scroll, focus and text in a scaled layer, every panel rendering live
when zoomed out. Panels are independent modules, so a canvas could later be another layout over
them (open: revisit after semantic zoom has been used).

Approved mock: `.local/mocks/workspace.html` (local, not versioned), frozen for the MVP
2026-10-12; its glyphs are placeholders for Tabler's. What it shows is built, with the revisions
dated in `features/`.

## Not taken

- Naming the agent at work; "last changed 40s ago" on cards (no source without watching every
  project).
- Tabs at level 1 (2026-10-13).
- Long structured notes (revisit if needed); a filter in Files.
- A dot on the tray icon for hidden changes (always on while an agent works; 2026-10-14).
- Comparing against the default branch / merge base (2026-10-14): Changes compares against HEAD
  as VS Code and Zed do; commits are looked at in the recent commits.
- Following the terminal (2026-10-16): no automatic switch to the project of the terminal tab used
  last; switching stays manual (`[`/`]`, `⌘K`, level 0, `sidekyk .`). Every signal breaks on some
  axis (agent, terminal, shell, tmux, OS): terminal APIs (one adapter per terminal, settings to
  enable, blind under tmux; built for kitty on macOS, then dropped), agent hooks (not every
  agent), shell hooks (silent while the agent runs), tty access time (unchanged on macOS; no ttys
  on Windows), window titles (permissions on macOS, overwritten by agents). Kept in mind: follow
  the activity (project whose files changed last), if the manual switch proves not enough.
- In the viewer (2026-10-18): several hunks with a comment each copied as one batch; a
  side-by-side view; unchanged regions expanded on demand ("Changes | Full file" stays); opening
  the file in the editor at a hunk's line; a setting for the diff's context lines (git's three).
- A rail of the projects beside a project's tiles (2026-10-18, built then dropped): `Esc` to the
  cards is quicker than aiming at an avatar, and its counts went stale (other projects are not
  watched, `features/projects.md`).
- From tazly: layered glass blur (GPU), rich-text editors. Taken from it: one command bar, `Esc` cancels before navigating, notes with copy, `⌥` shortcuts matched on
  `e.code`. Open: quick capture of a note via a global shortcut; a `PRODUCT.md`.

## Out of scope

- Writing to git or to files (stage, commit, revert, edit): the agent, terminal or editor does it.
- Running or embedding the agent.
- Replacing the `git` CLI with `gix`/libgit2 while process startup is not the measured bottleneck.
