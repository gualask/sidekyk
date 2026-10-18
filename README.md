# Sidekyk

A small desktop companion for reviewing what changed in a local git working tree, while a coding
agent works in your terminal. Keep it in the background; bring it up when you want to look at the
changes, then copy a hunk and paste it back to the agent.

Sidekyk is read-only. It never stages, commits or edits files. It is built to be fast and light:
instant when you bring it up, close to idle when it sits in the background.

## Features

- Several repositories as projects: switch from the rail, see them all as cards (branch, changes,
  waiting notes), zoom from all projects to a project's panels to one panel full screen.
- Changes: files grouped as changes, new files and staged; diff or full file, syntax colored,
  refreshed when files or refs change on disk; recent commits; a scrollbar that maps the changes;
  `n`/`p` from change to change across files.
- Copy on click: a line, a hunk or a selection goes to the clipboard through your template
  (`path:lines` plus a `diff` block by default), ready to paste to Codex, Claude Code or any other
  agent.
- Files: the project's tree, changes colored, any file viewed.
- One palette: `⌘K` by name (projects, panels, files, notes), `⌘F` in the files' contents.
- Notes per project, as cards in lists; export to Markdown.
- In the background: tray icon with the change count, a global shortcut to show or hide, no work
  while hidden.

## Docs

What is left to build: [ROADMAP.md](ROADMAP.md). How Sidekyk works and why it is built that way:
[docs/](docs/README.md).

## Requirements

- macOS, Linux or Windows. Sidekyk is built for all three with Tauri; it is developed and tested
  on macOS, and Linux and Windows are not tested yet
- `git` on the PATH, or in `/opt/homebrew/bin`, `/usr/local/bin` or `/usr/bin` (macOS and Linux),
  or in `C:\Program Files\Git\cmd` (Windows)
- On Linux, the WebKitGTK and other system libraries listed in Tauri's
  [prerequisites](https://v2.tauri.app/start/prerequisites/)
- Rust toolchain and pnpm 11

## Run

```sh
pnpm install
pnpm tauri:dev
```

The app adds and opens the repository of the folder given as its first argument, else it opens the
project it showed last.

## Logs

Sidekyk writes a log to the app's log directory, and keeps the previous session's next to it:

| System | Log directory |
|---|---|
| macOS | `~/Library/Logs/io.github.gualask.sidekyk/` |
| Linux | `~/.local/share/io.github.gualask.sidekyk/logs/` (or under `$XDG_DATA_HOME`) |
| Windows | `%LOCALAPPDATA%\io.github.gualask.sidekyk\logs\` |


- `sidekyk.log` (release builds): startup, the repository opened, failures and panics. Nothing
  else is written, and nothing at all while the app is idle. Attach it when reporting a problem.
- `sidekyk-dev.log` (development builds, also on stderr): every git command with its duration,
  every watcher batch and whether it refreshed the app, every command's duration.

`SIDEKYK_LOG=error|warn|info|debug|trace` changes the level; release builds stop at `info`.

## Check

```sh
pnpm lint && pnpm typecheck && pnpm test && pnpm knip && pnpm boundaries:check
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

See `AGENTS.md` for conventions and `docs/architecture.md` for the layering; `docs/testing.md` says
what the checks cover.
