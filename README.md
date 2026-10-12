# Sidekyk

A small desktop companion for reviewing what changed in a local git working tree, while a coding
agent works in your terminal. Keep it in the background; bring it up when you want to look at the
changes, then copy a hunk and paste it back to the agent.

Sidekyk is read-only. It never stages, commits or edits files. It is built to be fast and light:
instant when you bring it up, close to idle when it sits in the background.

## Features

- Several repositories as projects: add them, switch from the rail on the left, see them all as
  cards and remove one from its ⋯ menu (its files are never touched).
- Summary of the repository: branch, ahead/behind, changed files and total lines added and removed
  against HEAD, and whether anything is uncommitted.
- Changed files grouped as changes, new files and staged, with per-file line counts.
- Unified diff per file, refreshed automatically when files or refs change on disk.
- Copy on click: a hunk (or the whole file) goes to the clipboard as `path:lines` plus a `diff`
  block, ready to paste to Codex, Claude Code or any other agent.
- Keyboard: `↑`/`↓` or `j`/`k` move between files.

## Roadmap

What is done and what is still missing is tracked in [ROADMAP.md](ROADMAP.md). Sidekyk is
growing into a project workspace (changes, files, notes, several projects): the direction is in
[docs/evolution.md](docs/evolution.md).

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

See `AGENTS.md` for conventions and `docs/architecture.md` for the layering.
