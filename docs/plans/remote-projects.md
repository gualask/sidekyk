# Plan: remote projects (WSL, containers)

Direction 2026-10-18. A repository in a WSL distro (later a container) watched from the app
installed on Windows (or the Mac). Steps in `ROADMAP.md`; tests on the container fixture
(`../testing.md`).

## Design

- Not through `\\wsl.localhost`: `ReadDirectoryChangesW` is not supported there (Everything's
  author; Syncthing's watcher fails with "Incorrect function"), so only polling would remain;
  Microsoft advises against working across the two file systems for speed; Windows git refuses a
  repo owned by the Linux user ("dubious ownership", git ≥ 2.35.2) until `safe.directory` is set.
  Not `wsl.exe git` per call either (`wsl.exe` start each time, still no watcher).
- A helper, `sidekyk-agent`, inside the distro, as Zed (`remote_server`) and VS Code (VS Code
  Server): git, files, watcher (inotify) and the modules that read them run there; the app
  forwards commands over the helper's stdin/stdout and renders. VS Code also reaches its WSL
  server through `wsl.exe`'s stdio (a relay to the server's loopback port).
- Split per module, not per `RepositoryBackend` call: content search reads every file
  (`open_file`) and syntax colors read the whole version at every block request; through the pipe
  that moves files, not answers. So `repository`, `search` and `syntax` run in the helper; notes
  stay in the app (the app's data, not the repository's).
  - Syntax in the helper (golden rule): only spans cross the pipe. Cost: syntect's 7-16 MB in both
    processes when local and remote projects are both colored (each loads it on its first text).
- Watcher and ignored-paths filter in the helper (2026-10-18): only relevant changes cross the
  pipe, never a burst under `node_modules` or `target`. The app tells the helper when the window
  hides or shows, so hidden it only marks, as locally (`../features/background.md`).
  - Built: the `RepositoryWatcher` port (raw changed paths) and `classify` in
    `modules/repository`; the module reads the disk only through `RepositoryBackend`. Still in
    `interfaces/tauri/state.rs`: what a batch does next (ignored filter, mark while hidden, tree
    check, caches). It moves to the core with the project state, which the helper runs, in the
    helper step.
- Same repo, a Cargo workspace: a core crate (`modules/`, `shared/`, infrastructure without
  Tauri), the Tauri app, the helper. Built: `src-tauri/crates/core` (`../architecture.md`); the
  helper's crate comes with the helper. A second binary of the app's package would pull Tauri and
  WebKitGTK into a static Linux build. Helper and app from one commit, versioned together: no
  compatibility matrix (Zed: version in the file name; VS Code: commit).
- Shipped in the Windows installer (`bundle.resources`; not `externalBin`, which wants the host's
  target triple), the Linux musl build of Windows' own arch (x64 or arm64). Zed and VS Code
  download theirs because they serve any OS/arch over SSH; one small static binary does not need
  a download server, works offline and behind proxies.
- Install on first use of a distro, as Zed: `~/.sidekyk-server/sidekyk-agent-<version> version`;
  if missing, copy from the app's resources (`wslpath -u` + `cp` from `/mnt/…`, stdin as
  fallback), temp name, `chmod 755`, `mv`. The helper removes older versions when it starts
  (Zed does not).
- Containers: same helper, `docker exec -i` instead of `wsl.exe`. A container that bind-mounts a
  host folder (the usual dev container) needs none: the app watches the folder on the host.

### Project identity (2026-10-18)

A project has an opaque `id` and a typed `location`: `local { root }` or
`wsl { distro, root }` (`root` a Linux path). The frontend keys everything by `id`; the backend
routes by `location`. Zed and VS Code do the same: Zed stores `Wsl { distro_name, user }` and the
Linux paths in separate columns; VS Code's identity is `vscode-remote://wsl+<distro>/<path>`.

- Not the `\\wsl.localhost\…` path as root (rejected 2026-10-18): a convention to parse, two
  forms (`\\wsl$\` alone on older Windows 10), two distros with one path would collide, and any
  code that treats it as a folder starts the distro (Zed drops such local workspaces from its
  history for that reason).
- A local project's `id` is its root as today: the stored list, layouts and notes
  (`notes/store.rs` links a folder to a root) need no migration.
- The folder dialog turns `\\wsl.localhost\<d>\…` or `\\wsl$\<d>\…` into `wsl { … }` at once,
  as Zed's (VS Code only suggests "Reopen in WSL"); `git rev-parse` in the distro then gives the
  root.
- No `user`: the distro's default user, the one the agent runs as (Zed has an optional one).
- Later: `sidekyk .` from a WSL shell, a script reading `$WSL_DISTRO_NAME` as both do.

### Protocol (2026-10-18)

- Frames: u32 little-endian length, then a JSON envelope `{ id, … }`. Requests and responses
  matched by `id`, several in flight; a stream (search in contents) ends with an end message;
  cancel is an explicit message (as VS Code; Zed has none in general). The helper logs on stderr,
  the app writes it to its log (as Zed).
- JSON (`serde_json`, already a dependency) over protobuf (Zed: a second schema beside the serde
  contracts) or a binary serde format (a new dependency). Measured 2026-10-18 on a real 2 MiB
  diff, release, Mac: +3.0% bytes, encode 2.5 ms, decode 2.4 ms, a local pipe < 3 ms; the
  frontend already gets the diff as JSON once. Measured again through `wsl.exe` before it stays.
- No acks, replay, heartbeat or reconnect: Zed and VS Code have them for network drops (SSH);
  over a local pipe a dead helper shows as end of file, is started again and the snapshot read
  anew.

### Lifecycle (2026-10-18)

- One helper per distro, a child of the app, started on first need; no daemon, no timer while
  idle.
- Alive while a project of its distro is on screen, the window hidden included (the tray mark).
  Otherwise it exits 60 s after its last request: level 0 does not start it again each time, and
  a helper kept longer keeps the WSL VM and its memory alive. Zed waits 10 min after a disconnect
  and VS Code 5 min (opt-in), both for network drops. The 60 s are set again from `wsl.exe`'s
  start time measured on Windows.
- A stopped distro is never started for a summary: `wsl.exe --list --verbose` (as VS Code before
  starting its server) with `WSL_UTF8=1` (otherwise UTF-16LE), and the card says it is stopped.
  It starts when its project is opened. Zed and VS Code do not check: opening starts the distro,
  their recent lists do not touch it.

### Trying it without a Linux build

Building the helper for Linux on the Mac is on hold (2026-10-18: a new tool or a ~1 GB image on a
metered connection). Meanwhile the helper builds for the Mac, and a switch of dev builds
(`SIDEKYK_AGENT=local`) runs local projects through it as a child process: protocol, module
split, watcher and lifecycle on real repositories, and its cost against the direct path on the
same repository. Linux-only parts (inotify, musl, uid 1000) wait for the container fixture.

## Rules when it lands

`AGENTS.md` then says: the helper is the only thing the app writes in a distro or container, under
`~/.sidekyk-server/`, never in a repository; the invariants (`GIT_OPTIONAL_LOCKS=0`,
`core.fsmonitor=false`, `checked_path`, no refresh for ignored paths) hold in the helper; `wsl.exe`
and `docker exec` are child processes, in `infrastructure/` behind a port.

## Open

- Building the helper on the Mac for `aarch64-unknown-linux-musl` (on hold, above):
  `cargo-zigbuild` (a new tool, as Zed) or a Rust container (not on the 512 MiB fixture VM).
- Shipping the helper for containers on the Mac (arm64, amd64 under emulation).
- On Windows 11 x64, from the CI's release build: the protocol's cost through `wsl.exe`;
  `wsl.exe`'s start time; `--list --verbose` leaves a stopped distro stopped; distro names and
  case; the folder dialog's form of a WSL path.
- How a WSL project shows in the list and on its card (a preview first).

## Sources

- Zed (`.local/zed`, 93d7456): `crates/remote/src/transport/{wsl,docker}.rs`,
  `crates/remote_server`; identity `crates/remote/src/remote_client.rs:1346`,
  `crates/workspace/src/persistence.rs:885` (table), `:2189` (WSL paths dropped from history);
  `crates/util/src/paths.rs:1290` (`WslPath`); frames `crates/remote/src/protocol.rs:8`; envelope
  `crates/proto/proto/zed.proto:21`; heartbeat `remote_client.rs:161`; 10 min
  `crates/remote_server/src/server.rs:521`; `crates/zed/resources/windows/zed.sh:10`.
- VS Code (`microsoft/vscode` main, 00ab0906): `src/vs/base/parts/ipc/common/ipc.ts` (tagged
  binary values, objects as JSON, cancel `:40`), `ipc.net.ts` (persistent protocol, grace times
  `:304`), `src/vs/server/node/serverLifetimeService.ts:13` (5 min auto-shutdown, opt-in),
  `resources/win32/bin/code.sh:18`; the WSL extension is closed: its stdio relay seen in a user's
  log (https://qna.habr.com/q/1399122), "Reopen in WSL" in
  [vscode-remote-release#8009](https://github.com/microsoft/vscode-remote-release/issues/8009).
- `wsl.exe` output: UTF-16LE ([WSL#4607](https://github.com/microsoft/WSL/issues/4607)),
  `WSL_UTF8=1` since [0.64.0](https://github.com/microsoft/WSL/releases/tag/0.64.0).
- [WSL: working across file systems](https://learn.microsoft.com/en-us/windows/wsl/filesystems);
  watchers on `\\wsl$`: [Everything](https://www.voidtools.com/forum/viewtopic.php?p=83200),
  [Syncthing](https://forum.syncthing.net/t/filesystem-watcher-errors-incorect-function/17756)
- [VS Code: Developing in WSL](https://code.visualstudio.com/docs/remote/wsl),
  [Remote FAQ](https://code.visualstudio.com/docs/remote/faq)
- [Tauri: embedding external binaries](https://v2.tauri.app/develop/sidecar/),
  [embedding additional files](https://v2.tauri.app/develop/resources/)
