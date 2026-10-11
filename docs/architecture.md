# Architecture

Sidekyk is a Tauri 2 desktop app with a React/Vite frontend in `src/` and a Rust backend in
`src-tauri/`. It follows the same pragmatic modular-monolith layout as Fyler, scaled down to one
workflow.

## Data flow

```text
agent edits files ─▶ notify watcher (250 ms quiet period, filtered)
                        └─▶ skip paths git ignores (check-ignore, cached per directory)
                        └─▶ event "repository-changed" { version: 1, root }
                              └─▶ frontend invalidates ['repository', …] queries
                                    ├─▶ get_repository_snapshot  (status + numstat ×3)
                                    └─▶ get_file_diff            (one file, one area)
```

The snapshot also refetches when the window regains focus, as a safety net for changes the watcher
cannot see.

## Frontend

### Directory map

- `src/app/` — composition root: providers (`QueryClient`, runtime ports), shell, system color
  scheme. May depend on everything.
- `src/modules/changes/` — the review workflow.
  - `model/` — pure logic and wire types: unified-diff parser, agent snippet format, file grouping.
  - `application/` — `RepositoryPort` (context-provided) and the TanStack Query hooks.
  - `ui/` — summary bar, file list, diff view, hunk block, empty states.
- `src/infrastructure/platform/` — Tauri adapters (`invoke`, `listen`) implementing the ports.
- `src/shared/` — stable primitives: theme tokens, button/chip primitives, clipboard hook, error
  messages.
- `src/dev/` — browser fixtures (`?dev=app&scenario=…`), loaded lazily and only in dev builds.

### Dependency rules

- `app` composes everything and owns no workflow state.
- `modules` do not import `app`, `infrastructure`, `dev` or another module.
- `infrastructure` implements ports owned by modules; it does not import `app`.
- `shared` imports only `shared`.
- Direct `@tauri-apps/*` imports live only under `src/infrastructure/`.

`pnpm boundaries:check` enforces these rules.

### State

There is no client store. Git is the state: the snapshot and the diffs are TanStack Query caches
keyed by repository root, and the only UI state is the selected file, held in `ChangesWorkspace`.
When the selected file leaves the list, the selection falls back to the first file.

## Backend

- `bootstrap/` — plugins (single instance, dialog, store), managed state, command list. Opens the
  repository from the first CLI argument, else the last one used.
- `interfaces/tauri/` — commands (`get_active_repository`, `pick_repository`,
  `get_repository_snapshot`, `get_file_diff`) and `state.rs`, the one place that switches the open
  repository and its watcher. Blocking git work runs on `spawn_blocking`.
- `modules/repository/` — porcelain v2 and numstat parsers, snapshot assembly, diff loading, path
  validation, the ignored-paths filter for watcher events, wire contracts. No Tauri; the outside world is the `RepositoryBackend` port.
- `infrastructure/` — `git_cli.rs` (the `git` CLI, found on PATH or in the usual install dirs),
  `watcher.rs` (`notify-debouncer-mini`, sorting events into git-dir and working-tree changes), `settings_store.rs` (last
  repository, through `tauri-plugin-store`).
- `shared/error.rs` — `AppError`, serialized as `{ code, message }` with stable codes.

### Snapshot

1. `git status --porcelain=v2 -z --branch --untracked-files=all` — branch, ahead/behind, entries.
2. `git diff --numstat -z` and `git diff --cached --numstat -z` — per-file counts per area.
3. Untracked files are counted by reading them (binary when a NUL appears in the first 8 KiB).
4. Totals compare against HEAD (`git diff HEAD --numstat`), so a line staged and edited again
   counts once. Before the first commit the staged and unstaged counts are added instead.

The four git commands are independent and run in parallel, so a snapshot costs about as much as
the slowest of them. `snapshot_timing` (an ignored test, see `AGENTS.md`) measures it on any
repository.

### Diffs

`git diff [--cached] --no-color --no-ext-diff -U3 -- <path>`; a staged rename passes both paths;
an untracked file uses `--no-index /dev/null <path>`. Output larger than 2 MiB is cut at a line
boundary and flagged `truncated`. The frontend parses the text, so user settings such as
`diff.noprefix` do not matter: parsing starts at the first `@@`.
