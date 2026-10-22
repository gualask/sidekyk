# Plan: remote projects (WSL, containers)

Direction 2026-10-18. A repository in a WSL distro (later a container) watched from the app
installed on Windows (or the Mac). Steps in `ROADMAP.md`; tests on the container fixture
(`../testing.md`). WSL is built (`../features/projects.md`); its "Built:" notes stay here until it
is tried on Windows (Open), then the plan keeps only containers.

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
  - Built: the `RepositoryWatcher` port (raw changed paths), `classify`, and what a batch does
    next in `modules/repositories` (`Repositories`, `../architecture.md`), which the app runs
    for local projects and the helper serves. The palette's files are ranked there too
    (`search_files`): only matches cross the pipe, never the tree.
- Same repo, a Cargo workspace: a core crate (`modules/`, `shared/`, infrastructure without
  Tauri), the Tauri app, the helper. Built: `src-tauri/crates/core` (`../architecture.md`); the
  helper's is `crates/agent`. A second binary of the app's package would pull Tauri and
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
  - Built (`infrastructure/wsl.rs` in the core): the name is
    `sidekyk-agent-<version>-<hash of the file>`, so two builds of one version (CI's trial
    builds) never share it; `version` is checked at each start, one `wsl.exe` call before
    `serve`. Started as Zed starts its server, `wsl.exe --distribution <d> --cd ~ --exec
    .sidekyk-server/<name> serve`, no shell. A folder of a distro, from the folder dialog or
    Locate…, makes a WSL project (`wsl_path`: `\\wsl.localhost\`, `\\wsl$\`, `\\?\UNC\`);
    the notes export refuses a path inside one. Every machine is told the window's visibility and
    the projects it keeps; a machine not on screen is told to watch nothing, which starts no
    helper.
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
- Built: `Project { id, name, location }` (`../features/projects.md`); the id is made from the
  location, opaque to the frontend. Since 2026-10-22 `{ id, name, folders }`, the id made once
  (`../features/projects.md`). The app routes a project to what reads it by its folder
  (`ProjectsState::repositories_at`).

### How a WSL project shows (2026-10-18)

Agreed on previews. Built: `WSL: Ubuntu` before the folder on the card, after the name in the top
bar (the rail's tooltip too, until the rail went); no middle dot, the form VS Code's remote
indicator uses. Built too (`../features/projects.md`; `?dev=app&scenario=problems`, and the
`review` scenario's WSL project, which takes 1.5 s to start):

- A stopped distro's card: "Ubuntu is not running. Open the project to start it." instead of
  the counts (its `stopped` chip went with the card's chips, 2026-10-18).
- Opening it the first time (distro, helper copied): the panels' own loading state, with
  "Starting Ubuntu…".
- Problems, as `repository_missing`: WSL or the distro gone, "Ubuntu is not installed" (Try again,
  Remove); no git in the distro, "git is not installed in Ubuntu", installed with the distro's
  package manager (`sudo apt install git` on Ubuntu and Debian) (Try again); the helper fails,
  "Sidekyk could not start in Ubuntu" (Try again, details in the log).

### Protocol (2026-10-18)

- Frames: u32 little-endian length, then a JSON envelope `{ id, … }`. Requests and responses
  matched by `id`, several in flight; a stream (search in contents) ends with an end message;
  cancel is an explicit message (as VS Code; Zed has none in general). The helper logs on stderr,
  the app writes it to its log (as Zed).
- Built (`infrastructure/agent/` in the core, `crates/agent`): one request per method of the
  `Repositories` port; a reply carries its value as raw JSON, read once as the type the caller
  expects; a search in contents sends its files, then its reply; changes come up unasked. Frames
  over 64 MiB are a broken stream. A failure keeps its user-facing code across. The helper
  answers each request on a thread of its own, but takes in arrival order what depends on it:
  stop, visibility, forgetting projects, a search in contents' turn (two typed in a row could
  otherwise start in the wrong order and the older one win).
- The window's visibility is not waited for (the app tells it on its main thread): a change the
  helper missed while hidden comes up as a change.
- JSON (`serde_json`, already a dependency) over protobuf (Zed: a second schema beside the serde
  contracts) or a binary serde format (a new dependency). Measured 2026-10-18 on a real 2 MiB
  diff, release, Mac: +3.0% bytes, encode 2.5 ms, decode 2.4 ms, a local pipe < 3 ms; the
  frontend already gets the diff as JSON once. Measured again through `wsl.exe` before it stays.
- Measured through the helper on the Mac, 2026-10-18 (`agent_timings`, release, medians): a
  request's round trip 20-35 µs; snapshot unchanged (this repo 11.0 ms, Zed's clone 36.2 ms);
  the palette's files in Zed's tree 173 → 254 µs; a 2 MiB diff 32.2 → 36.9 ms. Under the 20 ms
  kept as the threshold: JSON stays.
- No acks, replay of lost messages, heartbeat or reconnection grace: Zed and VS Code have them
  for network drops (SSH); over a local pipe a dead helper shows as end of file, a new one is
  started and the snapshot read anew.
- Built: the requests waiting on a helper that stops fail; the next request that waits for a
  reply starts a new one (one that does not wait never does), told first the repository watched
  and whether the window is hidden, as they are then. One that ran 10 s or more makes the app
  read the repository on screen again (when the window shows), which starts the next; one that
  stops or fails to start sooner is not started again for 10 s. A request that panics, or whose
  answer is too long to send, still gets a reply: the app waits for each. Watches run on one
  thread, in the order they came. A change names the repository by the root it was watched by
  (not the folder git resolves), and one of a repository no longer watched is dropped: the
  helper may send one before it takes the next watch.

### Lifecycle (2026-10-18)

- One helper per distro, a child of the app, started on first need; no daemon, no timer while
  idle.
- Alive while a project of its distro is on screen, the window hidden included (the tray mark).
  Otherwise the app closes its stdin 10 min after its last request, and it exits (2026-10-18, the
  maintainer's call, as Zed after a disconnect; VS Code 5 min, opt-in): a short pause or level 0
  never waits for a new helper, and the WSL VM it keeps alive for those 10 min is acceptable. The
  repositories of one distro share its helper: switching between them starts nothing. Back after
  10 min, the panels show what was read before while a new helper reads again.
- A stopped distro is never started for a summary, and the card says it is stopped. Read from
  `wsl.exe --list --running --quiet` and `--list --quiet` (2026-10-18), names only: the columns
  of `--list --verbose` (VS Code's, before starting its server) are in the language of Windows,
  `Running` a translated word. `WSL_UTF8=1`, and UTF-16LE read too for an older `wsl.exe`.
  It starts when its project is opened. Zed and VS Code do not check: opening starts the distro,
  their recent lists do not touch it.

### Trying it without Windows

- The helper beside a dev build of the app: `cargo build --manifest-path src-tauri/Cargo.toml -p
  sidekyk-agent`, then `SIDEKYK_AGENT=local pnpm tauri:dev` reads local projects through it, a
  child process (protocol, module split, watcher, lifecycle). Release builds ignore the switch.
- The Linux helper in the container fixture (2026-10-18): not built on the Mac (a new tool or a
  ~1 GB image on a metered connection) but by `build.yml` for arm64 too, on GitHub's arm64
  runner; `scripts/container-fixture.sh helper <binary>` runs `crates/agent/tests/container.rs`.
  The install and start (`infrastructure/linux_helper.rs`) take a `LinuxMachine`: a WSL distro
  through `wsl.exe`, the fixture through `docker exec`. Tried there: install through stdin, the
  older build removed, reads, inotify (an ignored write tells nothing), a change missed while
  hidden, closing once idle. Measured (aarch64 fixture, 1 CPU): installed and first answer
  292 ms, a snapshot 4.4 ms, started again once installed 119 ms. Left to Windows: `wsl.exe`,
  the copy through `wslpath`, the distro states.

## Open

- Shipping the helper for containers on the Mac (arm64, amd64 under emulation).
- On Windows 11 x64, from `build.yml`'s unsigned build: the protocol's cost through `wsl.exe`;
  `wsl.exe`'s and the helper's start time; `--list --running --quiet` leaves a stopped distro
  stopped; distro names and case; the folder dialog's form of a WSL path; `--exec env <path from
  ~>`; the install through `wslpath` from the resources (`\\?\` dropped) and through stdin.
- The palette lists two `shop`s alike (a local and a WSL clone): name the distro there too? Ask
  with a preview first.

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
