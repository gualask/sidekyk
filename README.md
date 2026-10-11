# Sidekyk

A small desktop companion for reviewing what changed in a local git working tree, while a coding
agent works in your terminal. Keep it in the background; bring it up when you want to look at the
changes, then copy a hunk and paste it back to the agent.

Sidekyk is read-only. It never stages, commits or edits files. It is built to be fast and light:
instant when you bring it up, close to idle when it sits in the background.

## Features

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

- macOS (Linux and Windows untested)
- `git` on the PATH, or in `/opt/homebrew/bin`, `/usr/local/bin` or `/usr/bin`
- Rust toolchain and pnpm 11

## Run

```sh
pnpm install
pnpm tauri:dev
```

The app opens the folder given as its first argument, else the last repository it showed.

## Check

```sh
pnpm lint && pnpm typecheck && pnpm test && pnpm knip && pnpm boundaries:check
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

See `AGENTS.md` for conventions and `docs/architecture.md` for the layering.
