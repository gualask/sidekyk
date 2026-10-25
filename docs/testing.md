# Testing

Commands: `AGENTS.md`, Commands. This file says what each covers.

## Checks and tests

- Frontend: `vitest` (models and parsers, some hooks), Biome, TypeScript, knip, `boundaries:check`
  (`architecture.md`), `i18n:check` (`features/languages.md`). Tests run in Node; a hook's test
  (`*.test.tsx`, `// @vitest-environment happy-dom` at the top) renders it with `renderHook`
  (`src/shared/testing/render-hook.tsx`, React's `act`); `vi.waitFor` waits for a query. Fakes
  give only the port methods the hook calls. Components with layout (virtualized lists, view
  transitions) are checked on the browser fixtures.
- Backend: `cargo test`, clippy, rustfmt. End-to-end tests run a real git on scratch repositories,
  the watched ones a real watcher too.
- Helper (`crates/agent/tests`): the `sidekyk-agent` binary started as the app starts it, its
  answers compared with direct reads; failures keep their code; changes, and one missed while
  hidden, come through.
- Test dependencies (2026-10-24): `happy-dom` over `jsdom` (7 dependencies against 20, faster) and
  over Vitest's browser mode (Playwright's browsers on every machine and run); no
  `@testing-library/react`: its `renderHook` is a few lines on `act`, and it brings
  `@testing-library/dom` (2.5 MB, 8 dependencies).

## CI

On demand only (Actions, Run workflow; 2026-10-18): the checks run on the Mac day to day, every
platform before a release. Actions pinned to a commit, the version in a comment.

- `ci.yml`: the frontend checks and rustfmt on Linux; clippy and `cargo test` on Linux, macOS and
  Windows, so `#[cfg]` code and each real watcher are built and tried. The Mac cannot type-check
  for Windows (`onig_sys` builds C).
- `build.yml`: an unsigned Windows x64 build, NSIS and MSI as artifacts (14 days; SmartScreen
  warns). Linux jobs build the static helper first (musl, `musl-gcc` for its C; x64, and arm64 on
  an arm64 runner for the container fixture); the x64 one goes into the installer's resources
  (`tauri build --config src-tauri/tauri.helper.conf.json`). Other builds have no helper: WSL
  projects fail with `helper_failed`.

## Browser fixtures

`pnpm dev`, `http://localhost:1420/?dev=app&scenario=…` (`src/dev/`, dev builds only): the app on
in-memory ports. UI changes are checked there, light and dark.

- Scenarios: `review` (changes, commits, notes, long files changed in many places; a WSL clone
  whose helper takes 1.5 s to start), `clean`, `no-repo`, `large`, `problems` (a missing
  repository; WSL projects stopped, gone or without git; `api`'s distro stopped shows its Start
  panel). `review` and `clean` have `Vault`, a folder without git (Markdown, an `.ignore`;
  `guide.md` holds every construct the preview shows, an image and an SVG beside it); `review`'s
  `README.md` is changed, for its Preview. The Vault and the shop's Markdown are files
  (`src/dev/fixture-files/`); their previews are the backend parser's, written to
  `previews.json` by the Rust test `fixture_previews`, which fails while it is out of date
  (`SIDEKYK_UPDATE_FIXTURES=1 cargo test --manifest-path src-tauri/Cargo.toml -p sidekyk-core
  fixture_previews` writes it again; 2026-10-25, over a second parser in TypeScript). New
  project picks the scenario's repository and a folder without git in turn.
- `&open=<name>` starts as `sidekyk <folder>`. In the console: `sidekykDev.openFolder('<name>')`
  (the project, else one made), `gitInit('<name>')` and `gitRemove('<name>')` (told as the
  watcher would), `stopDistro('<name>')` (`wsl --shutdown`; the next read starts it),
  `writeFile('<name>', '<path>', '<text>')` (an agent writing a file, told as the watcher would;
  without a text, its later version in `fixture-files/edits/`, whose preview is generated too).

## Timing tests

Ignored by default, run in release with `--ignored --nocapture`:

- `backend_timings` (`SIDEKYK_BENCH_REPO=<repo>`): snapshot, summary, tree and its walk without
  git, the palette's search over it, the largest Markdown file's preview (read, parsed, as JSON),
  recent commits, the diff of the largest changed file.
- `syntax_colors_while_written` (`SIDEKYK_BENCH_FILE=<file>`): colors while the file on screen is
  written every 250 ms.
- `agent_timings` (`-p sidekyk-agent`): the same reads directly and through the helper.
- `notes_timings`: 1,000 notes read and changed.

## Container fixture

A Linux container standing in for a WSL distro on the Mac (Colima), to try the helper
(`features/wsl.md`) without Windows.

- Same shape as WSL: files on the VM's own file system, edited by Linux processes; the app reaches
  them only through a process started in there (`docker exec -i` here, `wsl.exe --exec` on
  Windows) over its stdin and stdout. It covers everything above that process (helper, protocol,
  versions, lifecycle, inotify, Linux git, a uid-1000 account); not `wsl.exe` and its distro list,
  `\\wsl.localhost\` paths, the copy into the distro, a distro starting, `CREATE_NO_WINDOW`, WSL1,
  ARM64.
- Setup: `brew install colima docker docker-compose`; `~/.docker/config.json` needs
  `"cliPluginsExtraDirs": ["/opt/homebrew/lib/docker/cli-plugins"]`. Without Colima the current
  Docker context is used.
- VM: Colima profile `sidekyk`, 1 CPU, 512 MiB, disks 4 GiB data and 4 GiB system (thin, ~870 MB
  used), made by the first `up` or `test`; the user's Docker context is given back. `test` grows it
  to 4 CPUs and 3 GiB while building. A disk only grows (shrink: `colima delete --profile sidekyk
  --data`). On the Mac the VM takes its whole memory once its cache fills it (524 MB at 512 MiB);
  the script runs `fstrim` before each stop (a 3.1 GB disk file for 1.2 GB used, 2026-10-21). A VM
  made before 2026-10-21 resolved names through `192.168.5.3`, which stopped answering: delete and
  `up` again.
- Image (`tests/container/`): Ubuntu 24.04 pinned by digest, git, inotify-tools and the Rust
  toolchain (`RUST_VERSION`, the Mac's), 1.23 GB, the engine's arch (aarch64 on Apple Silicon:
  `aarch64-unknown-linux-musl`). Account `ubuntu` (uid 1000). Repository `/home/ubuntu/project` on
  a named volume (`seed.sh`: two commits, one change of each kind, an ignored `build/`), kept until
  `down`.

```bash
scripts/container-fixture.sh up       # starts Colima if needed, builds, seeds
scripts/container-fixture.sh edit     # a burst of writes from inside, one under ignored build/
scripts/container-fixture.sh watch    # inotify events inside (Ctrl-C to stop)
scripts/container-fixture.sh shell    # bash in the repository
scripts/container-fixture.sh status   # engine, fixture, git status
scripts/container-fixture.sh test     # the core's and the helper's tests on Linux
scripts/container-fixture.sh helper [sidekyk-agent]  # the helper end to end
scripts/container-fixture.sh clean    # removes what test built (src-tauri/target/linux)
scripts/container-fixture.sh down     # removes fixture and repository (--colima: stops the VM)
```

- `test`: `cargo test -p sidekyk-core -p sidekyk-agent` on Linux git and inotify, the Linux half of
  `ci.yml` without CI. Sources mounted read-only, crates from the Mac's `~/.cargo/registry`, builds
  in `src-tauri/target/linux` (262 MB). First build 39 s, then 8 s; from a stopped VM ~2 min
  (2026-10-21).
- `helper`: `crates/agent/tests/container.rs` with the real Linux helper (the one `test` built, or
  `build.yml`'s static `sidekyk-agent-linux-arm64`), installed in `~/.sidekyk-server/` through
  `docker exec -i`, then read, watched (an edit inside, a write under ignored `build/`), told the
  window hid and showed, a folder without git read and watched (its `.ignore`, `git init` as a
  change of kind), closed once idle.
- Never a bind mount: with Colima's virtiofs a write on the Mac to a bind-mounted folder gives no
  inotify event inside (2026-10-18); a repository edited on the Mac is the local case anyway.
