# Container testing

A Linux container that stands in for a WSL distro on a Mac (Colima). Purpose: develop and test
remote projects (a repository that lives in a Linux filesystem the app reaches through a helper
process) without Windows.

## Why a container stands in for WSL

- Same shape: files on the VM's own filesystem, edited from inside by Linux processes; the app
  outside reaches them only by starting a process in there (`docker exec -i` here, `wsl.exe
  --distribution <d> --exec` on Windows) and talking over its stdin/stdout.
- What it can cover: everything above that process (helper binary, protocol, versions, lifecycle,
  inotify, Linux git, an ordinary uid-1000 account).
- Not covered (needs Windows): `wsl.exe` invocation and distro list, `\\wsl.localhost\<distro>\`
  paths from the folder dialog, copying the helper into the distro, a stopped distro starting,
  `CREATE_NO_WINDOW`, WSL1, Windows on ARM64.

## Setup (macOS)

```bash
brew install colima docker docker-compose
```

`~/.docker/config.json` needs `"cliPluginsExtraDirs": ["/opt/homebrew/lib/docker/cli-plugins"]`
for `docker compose`. Colima runs nothing until started and leaves nothing after a stop. Without
Colima, the script uses the current Docker context (Docker Desktop, a Linux engine).

- VM: Colima profile `sidekyk` (Docker context `colima-sidekyk`), 1 CPU, 512 MiB, disks 1 GiB
  for Docker's data and 4 GiB for the system (Colima's smallest; ~870 MB used), both
  thin-provisioned ceilings. Created by the first `up` with these values, kept apart from other
  projects' VMs; the script gives the user's Docker context back after starting it.
- Resizing: memory and CPUs with `colima start --profile sidekyk --memory N`; a disk only grows
  (Colima refuses a smaller one), so shrinking means `colima delete --profile sidekyk --data`.
- Memory on the Mac = the VM's whole memory once its page cache fills it (`footprint`: 1,022 MB
  at 1 GiB, 524 MB at 512 MiB; the guest itself uses ~160 MB). 512 MiB builds the image from
  scratch; compiling Rust inside does not fit.

## Fixture

`tests/container/`: Ubuntu 24.04 (WSL's default distro), pinned by digest, with git and
inotify-tools. Native arch of the engine: aarch64 on Apple Silicon, so a helper built for it
targets `aarch64-unknown-linux-musl`.

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
scripts/container-fixture.sh down     # removes fixture and repository (--colima: stops the VM)
```

## Never a bind mount

With Colima's virtiofs mount, a write on the Mac to a bind-mounted folder produces no inotify
event inside the VM; a write from inside does (verified 2026-10-18). A repository edited on the
Mac is the local case anyway: the app watches it directly, no helper.
