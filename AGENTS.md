# Repository Guidelines

Sidekyk is a Tauri 2 desktop companion (React frontend in `src/`, Rust backend in `src-tauri/`) for reviewing what changed in a local git working tree while a coding agent edits it. It targets macOS, Linux and Windows.

## Golden Rule: Performance

Instant when shown, near-zero CPU, memory and battery in the background. This outranks every other preference.

- Do no work nobody will see: nothing on a timer while idle, nothing for git-ignored paths, compute and render only what is on screen.
- Measure hot paths before and after a change; do not merge a regression without a reason.
- Run independent git commands in parallel, bound every read, never block the main thread. Lazy-load what the first paint does not need, virtualize long lists.
- Prefer a battle-tested crate or library to our own code, but never add a dependency yourself: present the candidates with pros and cons and wait for the maintainer's decision.
- Zed (`.local/zed`, a full clone; reclone if missing) is the reference for driving git and watching files. Its crates are GPL: read for ideas, never copy code (only GPUI is Apache-2.0).

## Commands

- `pnpm tauri:dev`: the desktop app; its log is `sidekyk-dev.log` in the app's log directory (macOS: `~/Library/Logs/io.github.gualask.sidekyk/`).
- `pnpm dev`: the frontend on fixtures, `http://localhost:1420/?dev=app&scenario=review|clean|no-repo|large|problems` (`src/dev/`). Check UI changes there, in light and dark.
- UI work with the maintainer: start `pnpm dev` in the background once and keep it running until the maintainer asks to stop it; Vite reloads every change, so never restart it between edits. Open the fixture page in the Playwright browser with the dark theme emulated (`prefers-color-scheme: dark`) and leave it there, so the maintainer watches each change live in that window. Say when you change the emulation or the page, since it is the maintainer's view too.
- Checks: `pnpm lint && pnpm typecheck && pnpm test && pnpm knip && pnpm boundaries:check && pnpm i18n:check`; `cargo test`, `cargo fmt --all -- --check`, `cargo clippy --all-targets -- -D warnings`, all with `--manifest-path src-tauri/Cargo.toml`.
- Container fixture (a WSL stand-in on Colima, `docs/testing.md`): `scripts/container-fixture.sh up|edit|watch|shell|status|down`.
- Backend timings: `SIDEKYK_BENCH_REPO=<repo> cargo test --release --manifest-path src-tauri/Cargo.toml backend_timings -- --ignored --nocapture`; through the helper against the direct path: same with `-p sidekyk-agent agent_timings`.
- Local projects through the helper (dev builds): `cargo build --manifest-path src-tauri/Cargo.toml -p sidekyk-agent`, then `SIDEKYK_AGENT=local pnpm tauri:dev`.
- Before handing off, run every check that covers the change: zero errors, zero warnings.

## Platforms

- Use a web API or CSS feature only if WKWebView, WebKitGTK and WebView2 all support it.
- Shortcuts: `⌘` on macOS, `Ctrl` elsewhere.
- Never assume `/` as separator or a Unix layout; paths exchanged with git and the frontend use `/`.
- Platform-specific code and child processes live in `infrastructure/`, behind `#[cfg]` and a port. Type-check `#[cfg(windows)]` code for `x86_64-pc-windows-msvc`; the Mac cannot (`onig_sys` builds C), so it is `ci.yml`'s job, run on demand (`docs/testing.md`, CI).

## Code

- Biome and rustfmt own formatting. Conditional JSX uses `cond ? (…) : null`, not `&&`. No `biome-ignore` or other suppressions: fix the root cause, or ask.
- Layers (`pnpm boundaries:check`): `@tauri-apps/*` only in `src/infrastructure/`; modules reach the backend through ports from React context; `modules` never import `app`, `infrastructure` or another module; outside a module only its `index.ts` is imported; `shared` imports only `shared`. In Rust, `src-tauri/crates/core` (modules, shared, git, watcher) has no Tauri; its `modules/` reach git and the disk only through ports (`RepositoryBackend`, `RepositoryWatcher`).
- Colors only from the `--ui-*` tokens (`*-ui-*` in Tailwind).
- UI text only from the catalogs (`src/shared/i18n/messages/`), English and Italian together;
  keys written whole, never built (`docs/features/languages.md`). Rust text for the user:
  `interfaces/tauri/texts.rs`.
- A contract change (`contracts.rs`, `repository.types.ts`) also updates the Tauri adapter, the fixtures and the serialization tests; a new error code needs its key in `app-error.ts` and its message in both catalogs.
- Hot-path logs are `debug`; `info` and above only for rare events and problems.
- Code comments in English.

## Docs

- In English, for people and coding agents: terse facts, decisions with their date and reason, measures, sources; no narrative, nothing the code already says.
- One file per area, about 500-1,200 words (`docs/README.md` lists them and says where things go): neither one file that explains a bit of everything nor a tree of small files. One fact in one file; the others point to it.
- `ROADMAP.md` holds only what is left, by theme, not a timeline; `**After:**` marks a technical dependency. A built item leaves it, and its plan, for `docs/features/` in the same commit.
- Plans and specs are local, not versioned: `.cflow/plans/`, `.cflow/specs/`. A plan wholly built is deleted.

## Invariants

- Read-only: never stage, commit, revert or write files in a repository.
- Git runs with `GIT_OPTIONAL_LOCKS=0` and `-c core.fsmonitor=false`.
- Paths from the frontend pass `checked_path` before reaching git.
- Only relevant changes refresh the app: never `*.lock` or git-ignored paths.
- In a WSL distro the app writes only its helper, under `~/.sidekyk-server/`; the helper runs the same core, so these invariants hold there. `wsl.exe` is a child process, in `infrastructure/`; nothing that waits on it runs on the main thread.
