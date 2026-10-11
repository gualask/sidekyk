# Repository Guidelines

Sidekyk is a lightweight Tauri 2 desktop companion for reviewing what changed in a local git working tree, typically while a coding agent (Codex, Claude Code, …) edits it. It is read-only: it never writes to the index or the working tree. Product scope and the roadmap are in `README.md`; the layering rules are in `docs/architecture.md`.

## Golden Rule: Performance

Sidekyk must feel instant and stay invisible on system resources. This rule outranks every other preference: judge each change first on speed and footprint, and use every technique that pays off. When speed and resource use pull apart, favor what the user notices: latency while the window is shown, near-zero CPU, memory and battery while it sits in the background.

- Do no work nobody will see. Changes in ignored paths (build output, dependencies) never trigger a refresh; compute and render only what is on screen; nothing runs on a timer while idle.
- Measure, do not guess. Time the hot paths (snapshot, diff, first paint, rendering a large diff) before and after a change, and do not merge a regression without a reason.
- Backend: run independent git commands in parallel, keep at most one snapshot in flight per repository and coalesce later requests into it, bound every read (bytes, output size, file count), and never block the main thread.
- Frontend: virtualize long lists and diffs, lazy-load anything not needed for the first paint (syntax highlighting, settings), parse once and memoize, keep re-renders local to what changed.
- Release builds are optimized for speed and size (LTO, one codegen unit, stripped).
- Do not reinvent the wheel. When a battle-tested Rust crate or React library solves the problem well, use it instead of writing our own. Weigh it on maintenance, adoption, bundle size, startup time and memory, and compare it with the platform or a few lines of code.
- Never add a dependency on your own: present the candidates with pros and cons to the maintainer and wait for a decision.
- Zed (`github.com/zed-industries/zed`) is the reference for how a fast Rust app drives git and watches the filesystem (`crates/git`, `crates/worktree`, `crates/fs`). Read it for ideas, but its crates are GPL-3.0-or-later: never copy code from them. Only GPUI is Apache-2.0.

## Project Structure & Module Organization

Renderer code is in `src/`: composition root and shell in `src/app`, the review workflow in `src/modules/changes` (`model/`, `application/`, `ui/`), native adapters in `src/infrastructure/platform`, stable primitives in `src/shared`, and browser fixtures in `src/dev`. The Rust backend is in `src-tauri/src`: `bootstrap/` (composition root), `interfaces/tauri/` (commands and managed state), `modules/repository/` (git parsing, snapshot, diff; no Tauri), `infrastructure/` (git CLI, watcher, settings store), `shared/` (error payload, coalescing).

## Build, Test, and Development Commands

- `pnpm install`: install dependencies.
- `pnpm tauri:dev`: run the full desktop app.
- `pnpm dev`: run the renderer in the browser on port 1420.
- `pnpm build`: type-check and build the renderer.
- `pnpm test`: run Vitest tests.
- `pnpm lint`: Biome lint and format check. `pnpm format` fixes formatting.
- `pnpm typecheck`, `pnpm knip`, `pnpm boundaries:check`: types, dead code, layer rules.
- `cargo test --manifest-path src-tauri/Cargo.toml`: Rust tests, including end-to-end tests against a real git in a scratch repository.
- `SIDEKYK_BENCH_REPO=<repo> cargo test --release --manifest-path src-tauri/Cargo.toml snapshot_timing -- --ignored --nocapture`: snapshot timing on a real repository, to compare before and after a change on the hot path.
- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` and `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`.

Before handing off, run every check that covers the change and leave zero errors and zero warnings.

## UI Development Workflow

Inspect UI changes in the browser on fixtures, not on live Tauri data. Run `pnpm dev`, then open `http://localhost:1420/?dev=app&scenario=review` (also `clean`, `no-repo`). The fixture ports and data live in `src/dev/`; add a scenario there when a state needs deterministic review. Check both light and dark (`prefers-color-scheme`).

## Coding Style & Boundaries

Biome and rustfmt own formatting (4 spaces, single quotes, 100 columns). PascalCase for components, `use*` for hooks, colocated `*.test.ts(x)`. Conditional JSX uses `cond ? (…) : null`, not `&&`. Never use `biome-ignore` or other suppressions: fix the root cause, or ask.

- Direct `@tauri-apps/*` imports live only in `src/infrastructure/`. Modules reach the backend through ports provided by React context (`RepositoryPort`), so `src/dev` can swap in fixtures.
- `modules` never import `app`, `infrastructure` or another module. `shared` imports only `shared`. `pnpm boundaries:check` enforces this.
- Colors come from the semantic `--ui-*` tokens in `src/shared/ui/theme.css`, mapped to Tailwind as `*-ui-*`. Never hardcode a color in a component.
- In Rust, `modules/` knows nothing about Tauri and reaches git and the filesystem only through `RepositoryBackend`.

## Cross-Layer Contracts

Command names, arguments, responses, the `repository-changed` event and the `{ code, message }` error payload are contracts between `src-tauri/src/modules/repository/contracts.rs` and `src/modules/changes/model/repository.types.ts`. Change the Rust types, the TypeScript types, the adapter in `src/infrastructure/platform/tauri-repository.ts`, the fixtures in `src/dev/` and the serialization tests together. A new user-facing error code also needs its message in `src/shared/errors/app-error.ts`.

## Invariants

- Read-only. No command may stage, commit, revert or write files. Git runs with `GIT_OPTIONAL_LOCKS=0` so a refresh never takes `index.lock` while the agent runs git, and never rewrites the index (which would wake the watcher again).
- Git runs with `-c core.fsmonitor=false`: Sidekyk opens any folder, and a repository's config must never make it run a command.
- Paths from the frontend pass `checked_path` (relative, no `..`) before reaching git.
- In the git dir, only the index, HEAD, refs and `info/` trigger `repository-changed` (never `*.lock`). In the working tree, a change triggers it unless git ignores the path (`git check-ignore`, with ignored directories remembered until a `.gitignore`, the index or the excludes change). The frontend then invalidates every `['repository', …]` query.
- Docs and code comments are in English.
