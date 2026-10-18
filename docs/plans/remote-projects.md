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
  forwards commands over the helper's stdin/stdout and renders.
- Split per module, not per `RepositoryBackend` call: content search reads every file
  (`open_file`) and syntax colors read the whole version at every block request; through the pipe
  that moves files, not answers. So `repository`, `search` and `syntax` run in the helper.
  - Syntax in the helper (golden rule): only spans cross the pipe. Cost: syntect's 7-16 MB in both
    processes when local and remote projects are both colored (each loads it on its first text).
- Same repo, a Cargo workspace: a core crate (`modules/`, `shared/`, infrastructure without
  Tauri), the Tauri app, the helper. A second binary of the app's package would pull Tauri and
  WebKitGTK into a static Linux build. Helper and app from one commit, versioned together: no
  compatibility matrix (Zed: version in the file name; VS Code: commit).
- Shipped in the Windows installer (`bundle.resources`; not `externalBin`, which wants the host's
  target triple), the Linux musl build of Windows' own arch (x64 or arm64). Zed and VS Code
  download theirs because they serve any OS/arch over SSH; one small static binary does not need
  a download server, works offline and behind proxies.
- Install on first use of a distro, as Zed: `~/.sidekyk-server/sidekyk-agent-<version> version`;
  if missing, copy from the app's resources (`wslpath -u` + `cp` from `/mnt/…`, stdin as
  fallback), temp name, `chmod 755`, `mv`. The helper removes older versions when it starts.
- Run: `wsl.exe --distribution <d> --cd ~ --exec <agent> serve`, piped, `CREATE_NO_WINDOW`; one
  process per distro; exits when its stdin closes. No daemon or reconnect (Zed keeps one for SSH
  drops; a local pipe does not drop): a dead helper is started again and the snapshot read anew.
- Protocol: length-prefixed `serde_json` (already a dependency); measure large diffs before
  keeping it.
- Containers: same helper, `docker exec -i` instead of `wsl.exe`. A container that bind-mounts a
  host folder (the usual dev container) needs none: the app watches the folder on the host.

## Rules when it lands

`AGENTS.md` then says: the helper is the only thing the app writes in a distro or container, under
`~/.sidekyk-server/`, never in a repository; the invariants (`GIT_OPTIONAL_LOCKS=0`,
`core.fsmonitor=false`, `checked_path`, no refresh for ignored paths) hold in the helper; `wsl.exe`
and `docker exec` are child processes, in `infrastructure/` behind a port.

## Open

- A remote project's identity in the project list, notes and commands (today a project is its root
  path; remote: distro or container plus a Linux path).
- Building the helper on the Mac for `aarch64-unknown-linux-musl`: `cargo-zigbuild` (a new tool,
  as Zed) or a Rust container (not on the 512 MiB fixture VM).
- The protocol's format if JSON is too slow on large diffs (a new dependency).
- Shipping the helper for containers on the Mac (arm64, amd64 under emulation).

## Sources

- Zed: `.local/zed/crates/remote/src/transport/{wsl,docker}.rs`, `crates/remote_server`
- [WSL: working across file systems](https://learn.microsoft.com/en-us/windows/wsl/filesystems);
  watchers on `\\wsl$`: [Everything](https://www.voidtools.com/forum/viewtopic.php?p=83200),
  [Syncthing](https://forum.syncthing.net/t/filesystem-watcher-errors-incorect-function/17756)
- [VS Code: Developing in WSL](https://code.visualstudio.com/docs/remote/wsl),
  [Remote FAQ](https://code.visualstudio.com/docs/remote/faq)
- [Tauri: embedding external binaries](https://v2.tauri.app/develop/sidecar/),
  [embedding additional files](https://v2.tauri.app/develop/resources/)
