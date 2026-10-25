# WSL projects

A folder in a WSL distro, read by Sidekyk's helper inside the distro (built 2026-10-18; not tried
on Windows yet, `ROADMAP.md`). Containers will reuse the helper
(`../../.cflow/plans/remote-projects.md`).

## Behaviour

- A folder under `\\wsl.localhost\<distro>\` or `\\wsl$\<distro>\` (folder picker, Locate…, command
  line) makes a WSL project, read in its distro, never through Windows' view of its files.
- `WSL: Ubuntu` before the folder on the card and after the name in the top bar, as VS Code's
  remote indicator: a Windows and a WSL clone of one repository are otherwise two `shop`s.
- A stopped distro starts only from its project's Start button (2026-10-24), whatever way the
  project is opened (card, `↵`, `[`/`]`, a note found). Card: "Ubuntu is not running." Level 1:
  Notes, and a Start panel as the main tile ("Start Ubuntu", then "Starting Ubuntu…"; no key)
  until the folder's panels take its place. Palette: no files; `⌘F` says the distro is not
  running. A distro already running opens at once, "Starting Ubuntu…" while its helper starts. One
  stopped while on screen starts again at the next read. `sidekyk <folder>` resolves the folder in
  its distro, starting it.
- Problems (Try again, Remove): WSL or the distro gone ("Ubuntu is not installed"), no git ("git is
  not installed in Ubuntu", with the package manager's command), the helper not starting
  ("Sidekyk could not start in Ubuntu", details in the log).

## How it is built

- Identity: `{ distro, root }`, `root` a Linux path, the distro's default user. `wsl_path` reads
  `\\wsl.localhost\`, `\\wsl$\` and `\\?\UNC\` once, where a folder is chosen; the notes export
  refuses a path in a distro.
- Routing: `Machines` (`infrastructure/machines.rs`) sends a project to `LocalRepositories` or to
  its distro's `AgentRepositories` (`WslRepositories`, one helper per distro). Every machine is
  told the window's visibility and the projects it keeps; one with nothing on screen is told to
  watch nothing, which starts no helper. "Nothing starts a distro unasked" is the machine's
  (`readable_without_starting`), checked by `search` and `search_contents`; the kind's query asks
  with `start` only from the Start button (`useStartFolder`).
- Distro state: `wsl.exe --list --running --quiet` and `--list --quiet`, names only (the columns of
  `--list --verbose` are in Windows' language); `WSL_UTF8=1`, UTF-16LE read too. Checked before a
  summary when no helper runs: `distro_stopped`, `distro_missing`, kept 5 s for the distro's other
  cards. A helper that cannot start or a `wsl.exe` that does not answer is `helper_failed`, never
  `distro_missing` (which offers Remove).
- Helper (`crates/agent`, `sidekyk-agent`, over `crates/core`): `repository`, `search` and `syntax`
  run there (git, files, the watcher and its filter, the palette's ranking of files), so only
  answers cross the pipe, never files, the tree or a burst under `node_modules`. Notes stay in the
  app. Cost: syntect's 7-16 MB in both processes when local and WSL projects are both colored.
- Shipped in the Windows installer (`bundle.resources`, the Linux musl build of its arch,
  `build.yml`). Installed on first use as `~/.sidekyk-server/sidekyk-agent-<version>-<hash>`
  (`wslpath -u` + `cp` from `/mnt/…`, stdin as fallback; a temp name, `chmod 755`, `mv`); `version`
  checked at each start; the helper removes older ones. Started as `wsl.exe --distribution <d> --cd
  ~ --exec .sidekyk-server/<name> serve`, no shell (`infrastructure/wsl.rs`, `linux_helper.rs` over
  a `LinuxMachine`, which the container fixture also implements).
- Protocol (`infrastructure/agent/`): frames of a u32 LE length and a JSON envelope `{ id, … }`,
  several in flight; one request per method of the `Repositories` port; a reply's value is raw
  JSON, read once as the caller's type; an image's bytes follow a `Bytes` message as a raw frame,
  not base64 (2026-10-25); a search in contents streams its files, then its reply;
  changes come unasked; cancel is a message; over 64 MiB is a broken stream; failures keep their
  code. Each request on a thread of its own, except what depends on order: stop, visibility,
  forgetting projects, a content search's turn. Visibility is not waited for: a change missed
  while hidden comes up as a change. A change names the root it was watched by; one of a
  repository no longer watched is dropped. The helper's stderr goes to the app's log.
- Lifecycle: one helper per distro, a child of the app, started by the first request that waits
  for a reply; no daemon, no timer. Alive while a project of its distro is on screen (hidden
  window included), else its stdin closes 10 min after its last request. One that dies fails the
  requests waiting; the next starts a new one, told the repository watched and the visibility. One
  that ran 10 s or more makes the app read the project on screen again; one that dies sooner is not
  started again for 10 s. No acks, replay, heartbeat or reconnection: over a local pipe a dead
  helper is end of file.
- Measured (2026-10-18, release): through the helper on the Mac (`agent_timings`), a round trip
  20-35 µs, a snapshot unchanged (Zed's clone 36.2 ms), the palette's files 173 → 254 µs, a 2 MiB
  diff 32.2 → 36.9 ms. In the container fixture (aarch64, 1 CPU): installed and first answer
  292 ms, a snapshot 4.4 ms, started again 119 ms.

## Decisions

- A helper in the distro (2026-10-18), as Zed's `remote_server` and VS Code Server, not
  `\\wsl.localhost`: `ReadDirectoryChangesW` is not supported there (Everything's author,
  Syncthing), Microsoft advises against working across the two file systems, and Windows git
  refuses a repository the Linux user owns until `safe.directory`. Not `wsl.exe git` per call: a
  start each time and no watcher.
- Split by module, not by `RepositoryBackend` call (2026-10-18): content search and syntax read
  whole files, which would cross the pipe.
- Identity typed, not the `\\wsl.localhost` path (2026-10-18): two forms to parse, two distros with
  one path collide, and code treating it as a folder starts the distro (Zed drops such workspaces
  from its history).
- Shipped, not downloaded: one small static binary, offline and behind proxies; Zed and VS Code
  download theirs to serve any OS over SSH. App and helper from one commit: no version matrix.
- JSON over protobuf (a second schema) or a binary serde format (a dependency), 2026-10-18: a real
  2 MiB diff +3.0% bytes, encode 2.5 ms, decode 2.4 ms; under the 20 ms threshold. To measure again
  through `wsl.exe`.
- 10 min idle (2026-10-18, the maintainer): a pause or level 0 never waits for a new helper; Zed
  10 min after a disconnect, VS Code 5 min, opt-in.
- A distro starts only when asked (2026-10-24, the maintainer): one rule for every way in, not by
  intent, else `[`/`]` would start every distro it passes; one click to work in a stopped one. Zed
  and VS Code start it on opening.

## Sources

- Zed (`.local/zed`, 93d7456): `crates/remote/src/transport/wsl.rs`, `crates/remote_server`;
  identity `crates/remote/src/remote_client.rs:1346`, `crates/workspace/src/persistence.rs:885`,
  `:2189` (WSL paths dropped from history); frames `crates/remote/src/protocol.rs:8`; 10 min
  `crates/remote_server/src/server.rs:521`.
- VS Code (`microsoft/vscode`, 00ab0906): `src/vs/base/parts/ipc/common/ipc.ts` (cancel `:40`),
  `src/vs/server/node/serverLifetimeService.ts:13` (5 min, opt-in); its WSL stdio relay seen in a
  user's log (https://qna.habr.com/q/1399122).
- `wsl.exe` output UTF-16LE ([WSL#4607](https://github.com/microsoft/WSL/issues/4607)),
  `WSL_UTF8=1` since [0.64.0](https://github.com/microsoft/WSL/releases/tag/0.64.0).
- [WSL: working across file systems](https://learn.microsoft.com/en-us/windows/wsl/filesystems);
  watchers on `\\wsl$`: [Everything](https://www.voidtools.com/forum/viewtopic.php?p=83200),
  [Syncthing](https://forum.syncthing.net/t/filesystem-watcher-errors-incorect-function/17756).
- [Tauri: embedding additional files](https://v2.tauri.app/develop/resources/).
