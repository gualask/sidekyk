# Docs

For people and coding agents working on Sidekyk. Terse: facts, decisions with their date and
reason, numbers, sources. One fact in one file; the others point to it.

- `product.md`: what Sidekyk is for, guardrails, layout, what is not taken, out of scope.
- `architecture.md`: data flow, frontend and backend maps, layer rules, git, watching, logs.
- `features/`: one file per area as built: behaviour, how it is built, decisions.
  - `workspace.md`: levels, tiles and sidebars, keys, settings, toasts and problems.
  - `projects.md`: identity, folders and their kind, level 0 cards, moved folders.
  - `wsl.md`: WSL projects and the helper (protocol, lifecycle, shipping).
  - `changes.md`: snapshot, diffs, commits, the viewer.
  - `syntax-colors.md`
  - `files.md`: tree, file view, folders without git, the shared selection.
  - `search.md`: palette, by name, notes, in contents.
  - `notes.md`: cards, lists, the Inbox, moving, storage.
  - `background.md`: tray, global shortcut, hidden window.
  - `languages.md`: English and Italian, catalogs, `i18n:check`.
- `testing.md`: what the checks, fixtures and timing tests cover; the container fixture.
- Plans, designs agreed but not built, are local and not versioned: `../.cflow/plans/`; specs
  made from them in `../.cflow/specs/`.

## Where things go

- To do: one line in `ROADMAP.md`, with a link to its plan when it has one.
- Built: the item leaves `ROADMAP.md`; what it does and why goes into `features/`, in the same
  commit, and leaves the plan. A plan wholly built is deleted.
- A decision states its date and reason; facts about other tools cite their source.
- Paths in `docs/` are relative to the file; `AGENTS.md` and `ROADMAP.md` are at the root.
