# Testing

Commands: `AGENTS.md`, Commands. This file says what each covers.

## Checks and tests

- Frontend: `vitest` (mostly models and parsers, some hooks and UI logic), Biome, TypeScript, knip
  (unused code), `boundaries:check` (layers, `architecture.md`). Tests run in Node; a hook's test
  (`*.test.tsx`) runs in `happy-dom`, asked by `// @vitest-environment happy-dom` at the top of its
  file, and renders the hook with `renderHook` (`src/shared/testing/render-hook.tsx`: React's
  `act` and `createRoot`, the providers through `wrapper`); `vi.waitFor` waits for a query's
  answer. Fakes give only the port methods the hook calls.
- Test dependencies (2026-10-24): `happy-dom` over `jsdom` (7 dependencies against 20, faster,
  enough for hooks) and over Vitest's browser mode (Playwright and its browsers on every machine
  and CI run); no `@testing-library/react`: its `renderHook` is the same few lines on React's
  `act`, and it brings `@testing-library/dom` (2.5 MB, 8 dependencies) for queries hooks do not
  need. Components with layout (virtualized lists, view transitions) stay checked on the browser
  fixtures.
- Backend: `cargo test`; end-to-end tests run a real git on scratch repositories, the watched
  repository a real watcher too. clippy and rustfmt.
- Helper (`crates/agent/tests`): the `sidekyk-agent` binary started as the app starts it, its
  answers compared with the direct reads, failures keeping their code, changes and a change
  missed while hidden coming through.

## CI

On demand only (Actions, Run workflow), decided 2026-10-18: day to day the checks run on the
machine at hand (the Mac); every platform is checked before a release.

- `ci.yml`: the frontend checks on Linux; rustfmt on Linux; clippy and `cargo test` on Linux,
  macOS and Windows, so `#[cfg]` code and the real watcher (inotify, FSEvents,
  `ReadDirectoryChangesW`) are built and tried on each. The Mac cannot type-check for Windows
  (`onig_sys` builds C).
- `build.yml`: an unsigned Windows x64 build; its NSIS and MSI installers are the run's artifact
  (14 days). SmartScreen warns before running them. Linux jobs build the helper first
  (`sidekyk-agent`, static, musl with `musl-gcc` for its C; x64, and arm64 on an arm64 runner for
  the container fixture, both artifacts for 14 days); the x64 one
  `tauri build --config src-tauri/tauri.helper.conf.json` puts in the installer's resources
  (`linux/sidekyk-agent`). Any other build (`cargo test`, clippy, `tauri dev`) has no helper: WSL
  projects then fail with `helper_failed`.
- Actions are pinned to a commit, their version in a comment; updated by hand.

## Browser fixtures

`pnpm dev`, `http://localhost:1420/?dev=app&scenario=…` (`src/dev/`, dev builds only): the app on
in-memory ports. Scenarios: `review` (changes, commits, notes, long files changed in many places),
`clean`, `no-repo`, `large`, `problems` (a missing repository; WSL projects whose distro is
stopped, gone or without git). `review` has a WSL clone of its project, whose helper takes 1.5 s
to start. `review` and `clean` have `Vault`, a folder without git (Markdown notes, an `.ignore`);
New project picks a repository, the scenario's own, then a folder without git in turn.
`&open=<name>` starts as `sidekyk <folder>` does, and `sidekykDev.openFolder('<name>')` in the
console opens one while the app runs: the project of that name, else one made for a folder of that
name. `sidekykDev.gitInit('<name>')` and `gitRemove('<name>')` stand in for `git init` and `.git`
removed in a project's folder, told as the watcher would; `sidekykDev.stopDistro('<name>')` stops
the distro of a WSL project (`wsl --shutdown`), whose next read starts it again. In `problems`,
`api`'s distro (Debian) is stopped: its Start panel. UI changes are checked there, in light
and dark.

## Timing tests

Ignored by default, run in release with `--ignored --nocapture`:

- `backend_timings` (`SIDEKYK_BENCH_REPO=<repo>`): snapshot, summary, file tree, the palette's
  search over it, recent commits with the newest's files, the diff of the largest changed file.
- `syntax_colors_while_written` (`SIDEKYK_BENCH_FILE=<file>`): syntax colors while the file on
  screen is written every 250 ms (`features/syntax-colors.md`).
- `agent_timings` (`-p sidekyk-agent`, `SIDEKYK_BENCH_REPO=<repo>`): snapshot, a folder, the
  palette's files and the largest diff, read directly and through the helper.
- `notes_timings`: 1,000 notes read and changed (`features/notes.md`).

## Container fixture

A Linux container that stands in for a WSL distro on a Mac (Colima), to build and try remote
projects (`plans/remote-projects.md`) without Windows.

### Why a container stands in for WSL

- Same shape: files on the VM's own filesystem, edited from inside by Linux processes; the app
  outside reaches them only by starting a process in there (`docker exec -i` here, `wsl.exe
  --distribution <d> --exec` on Windows) and talking over its stdin/stdout.
- What it can cover: everything above that process (helper binary, protocol, versions,
  lifecycle, inotify, Linux git, an ordinary uid-1000 account).
- Not covered (needs Windows): `wsl.exe` invocation and distro list, `\\wsl.localhost\<distro>\`
  paths from the folder dialog, copying the helper into the distro, a stopped distro starting,
  `CREATE_NO_WINDOW`, WSL1, Windows on ARM64.

### Setup (macOS)

```bash
brew install colima docker docker-compose
```

`~/.docker/config.json` needs `"cliPluginsExtraDirs": ["/opt/homebrew/lib/docker/cli-plugins"]`
for `docker compose`. Colima runs nothing until started and leaves nothing after a stop. Without
Colima, the script uses the current Docker context (Docker Desktop, a Linux engine).

- VM: Colima profile `sidekyk` (Docker context `colima-sidekyk`), 1 CPU, 512 MiB, disks 4 GiB
  for Docker's data and 4 GiB for the system (Colima's smallest; ~870 MB used), both
  thin-provisioned ceilings. Created by the first `up` or `test` with these values, kept apart
  from other projects' VMs; the script gives the user's Docker context back after starting or
  stopping it.
- Resizing: memory and CPUs with `colima start --profile sidekyk --memory N`; a disk only grows
  (Colima refuses a smaller one), so shrinking means `colima delete --profile sidekyk --data`.
  `test` grows the VM to 4 CPUs and 3 GiB while it builds, then leaves it as it found it.
- Memory on the Mac = the VM's whole memory once its page cache fills it (`footprint`: 1,022 MB
  at 1 GiB, 524 MB at 512 MiB; the guest itself uses ~160 MB). 512 MiB builds the image from
  scratch; compiling Rust inside does not fit.
- Disk on the Mac: what the VM frees stays taken in its disk file until trimmed; the script runs
  `fstrim` before each stop it makes (2026-10-21: 3.1 GB file for 1.2 GB used, 1.2 GB after).
- A VM created before 2026-10-21 resolved names through `192.168.5.3`, which stopped answering
  (`Temporary failure resolving` in `apt`); a VM created again uses `192.168.5.1` and works. Fix:
  `colima delete --profile sidekyk --data`, then `up`.

### The fixture

`tests/container/`: Ubuntu 24.04 (WSL's default distro), pinned by digest, with git and
inotify-tools, and the Rust toolchain that builds the tests (`test`): one image for both, 1.23 GB.
Native arch of the engine: aarch64 on Apple Silicon, so a helper built for it targets
`aarch64-unknown-linux-musl`.

- Account `ubuntu` (uid 1000), as the first user WSL creates.
- Repository `/home/ubuntu/project` on a named volume, created on first start (`seed.sh`): two
  commits, then one change of each kind (unstaged, staged, deleted, untracked) and an ignored
  `build/`.
- Survives restarts of the fixture and of Colima; `down` removes it.

```bash
scripts/container-fixture.sh          # usage, nothing else
scripts/container-fixture.sh up       # starts Colima if needed, builds, seeds
scripts/container-fixture.sh edit     # a burst of writes from inside, one under ignored build/
scripts/container-fixture.sh watch    # inotify events inside (Ctrl-C to stop)
scripts/container-fixture.sh shell    # bash in the repository
scripts/container-fixture.sh status   # engine, fixture, git status
scripts/container-fixture.sh test     # the core's and the helper's tests on Linux
scripts/container-fixture.sh helper [sidekyk-agent]  # the helper end to end in the fixture
scripts/container-fixture.sh clean    # removes what test built (src-tauri/target/linux)
scripts/container-fixture.sh down     # removes fixture and repository (--colima: stops the VM)
```

### Tests on Linux

`test [cargo test args]` builds and runs `cargo test -p sidekyk-core -p sidekyk-agent` in the
fixture's image, on Linux git and inotify (the watcher one folder at a time, `architecture.md`,
Watching): the Linux half of `ci.yml`'s tests without CI, for a change to the core.

- Sources mounted read-only; crates from the Mac's `~/.cargo/registry` (none downloaded twice);
  builds in `src-tauri/target/linux` on the Mac (262 MB), seen and removed with `clean`, never in
  the VM. The workspace's dev profile keeps them small (no incremental cache, line tables only).
- Rust pinned in the `Dockerfile` (`RUST_VERSION`, the Mac's); a rebuild without changes uses the
  layers kept as cache (no BuildKit here: `docker image prune` would drop them), and a changed
  `Dockerfile` replaces the image.
- Timings (2026-10-21, M-series Mac): first build 39 s, then 8 s; the core's tests 5 s; a whole
  `test` from a stopped VM ~2 min, most of it starting and resizing the VM.

### The helper in the fixture

`helper [binary]` runs `crates/agent/tests/container.rs` (ignored otherwise): the real Linux helper,
built for the fixture's arch (by default the one `test` built, glibc; `build.yml`'s static
`sidekyk-agent-linux-arm64` on Apple Silicon for the shipped one), installed
in `~/.sidekyk-server/` through `docker exec -i` as in a WSL distro, then read, watched (an edit
from inside, a write under ignored `build/`), told the window hid and showed, a folder without git
read and watched (a write its `.ignore` hides, a note added, `git init` told as a change of kind),
and closed once idle.
Timings printed (`--nocapture`); measured in `plans/remote-projects.md`.

### Never a bind mount

With Colima's virtiofs mount, a write on the Mac to a bind-mounted folder produces no inotify
event inside the VM; a write from inside does (verified 2026-10-18). A repository edited on the
Mac is the local case anyway: the app watches it directly, no helper.
