# Docs

For people and coding agents working on Sidekyk. Terse: facts, decisions with their date and
reason, numbers, sources.

- `product.md`: what Sidekyk is for, guardrails, layout, what is not taken, out of scope.
- `architecture.md`: layers, data flow, directory maps, dependency rules, state, git, logs.
- `features/`: one file per area as built: behaviour, how it is built, decisions.
  - `workspace.md`: shell, zoom levels, tiles and sidebars, keys, settings, toasts and problems.
  - `projects.md`: project list, summaries, level 0 cards, moved repositories.
  - `changes.md`: snapshot, diffs, commits, the viewer (copy, scrollbar map, `n`/`p`, find bar).
  - `syntax-colors.md`
  - `files.md`: tree, file view, the selection shared with Changes.
  - `search.md`: palette, by name, notes, in contents.
  - `notes.md`
  - `background.md`: tray, global shortcut, hidden window.
  - `languages.md`: English and Italian, catalogs, `i18n:check`.
- `plans/`: designs agreed but not built; `ROADMAP.md` items point here.
- `testing.md`: what the checks, fixtures and timing tests cover; the container fixture.

## Where things go

- To do: one line in `ROADMAP.md`, with a link to its plan when it has one.
- Built: the item leaves `ROADMAP.md` and its plan; what it does and why goes into
  `features/`, in the same commit.
- A decision states its date and reason; facts about other tools cite their source.
- Paths in `docs/` are relative to the file; `AGENTS.md` and `ROADMAP.md` are at the root.
