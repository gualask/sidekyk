#!/usr/bin/env bash
# Drives the container fixture (tests/container): a Linux box that stands in for a WSL distro.
# See docs/testing.md. A bare invocation prints usage and does nothing else.
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
fixture_dir="$repo_root/tests/container"
project=/home/ubuntu/project

# A Colima VM of its own, as small as the fixture allows, larger only while `test` builds (sizes
# and measures in docs/testing.md). Disks are ceilings, thin-provisioned; Colima refuses a smaller
# disk than the VM has, and the root disk is set only when the VM is created.
colima_profile=sidekyk
fixture_size=(1 512)
build_size=(4 3072)
colima_disks=(--disk 4)
colima_new_disks=(--root-disk 4)

# What `test` builds lives on the Mac, where it can be seen and removed (`clean`), never in the VM.
linux_target="$repo_root/src-tauri/target/linux"
if command -v colima >/dev/null 2>&1; then
	export DOCKER_CONTEXT="colima-$colima_profile"
fi

log() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
die() {
	printf '\033[1;31mxx\033[0m %s\n' "$*" >&2
	exit 1
}

usage() {
	cat <<EOF
Usage: scripts/container-fixture.sh <command>

  up              start the Colima VM '$colima_profile' if needed, build and start the fixture
  shell           a shell in the fixture, in the demo repository
  edit            change files from inside, as a coding agent would
  watch           print the inotify events seen inside (Ctrl-C to stop)
  status          engine, fixture, and the repository's git status
  test [args]     build and run the core's and the helper's tests on Linux, in the fixture's image
                  (the VM grows to ${build_size[0]} CPUs and ${build_size[1]} MiB meanwhile); args go
                  to cargo test
  helper [binary] run the Linux helper's end-to-end test in the fixture: [binary] a sidekyk-agent
                  built for the fixture's arch, by default the one 'test' built (or CI's
                  sidekyk-agent-linux-arm64 on Apple Silicon)
  clean           remove what 'test' built (src-tauri/target/linux)
  down [--colima] remove the fixture and its repository; --colima also stops the VM

Without Colima, the current Docker context is used.

The repository is $project on a named volume: it survives restarts of the
fixture and of Colima; only 'down' removes it.
EOF
}

# The image compose names after the project and the service.
image=sidekyk-fixture-distro

compose() { docker compose --project-directory "$fixture_dir" -f "$fixture_dir/docker-compose.yml" "$@"; }

in_fixture() { compose exec -T distro "$@"; }

colima_exists() { colima list --json 2>/dev/null | grep -q "\"name\":\"$colima_profile\""; }

# Runs a colima command and gives the user's Docker context back: `colima start` makes its own the
# current one for every shell, `colima stop` falls back to `default`; this script needs neither.
colima_keeping_context() {
	local previous
	previous=$(env -u DOCKER_CONTEXT docker context show 2>/dev/null || true)
	colima "$@"
	if [ -n "$previous" ] && [ "$previous" != "$(env -u DOCKER_CONTEXT docker context show 2>/dev/null)" ]; then
		env -u DOCKER_CONTEXT docker context use "$previous" >/dev/null 2>&1 || true
	fi
}

# Stops the VM. What it freed stays taken on the Mac until trimmed: given back first, so its disk
# file holds only what is used. Not right after a removal: Docker frees layers a moment later.
stop_vm() {
	colima ssh --profile "$colima_profile" -- sudo fstrim /var/lib/docker >/dev/null 2>&1 || true
	colima_keeping_context stop --profile "$colima_profile"
}

# The VM's memory in MiB, empty when there is no VM.
colima_memory() {
	colima list --json 2>/dev/null | grep "\"name\":\"$colima_profile\"" |
		sed -E 's/.*"memory":([0-9]+).*/\1/' | awk '{ print int($1 / 1048576) }'
}

# Starts the fixture's own Colima VM with <cpus> <MiB>, created on first run, stopped first when it
# runs with another size.
colima_start_sized() {
	local cpus=$1 mib=$2
	# LC_ALL=C: a decimal point, never the locale's comma
	local gib size
	gib=$(LC_ALL=C awk "BEGIN { print $mib / 1024 }")
	size=(--cpu "$cpus" --memory "$gib" "${colima_disks[@]}")
	if ! colima_exists; then
		log "Creating the Colima VM '$colima_profile' ($cpus CPUs, $mib MiB)"
		colima_keeping_context start --profile "$colima_profile" "${size[@]}" "${colima_new_disks[@]}"
		return
	fi
	if docker info >/dev/null 2>&1; then
		[ "$(colima_memory)" = "$mib" ] && return
		log "Stopping the Colima VM '$colima_profile' to resize it"
		stop_vm
	fi
	log "Starting the Colima VM '$colima_profile' ($cpus CPUs, $mib MiB)"
	colima_keeping_context start --profile "$colima_profile" "${size[@]}"
}

# ensure_docker makes `docker info` answer: the fixture's own Colima VM at <cpus> <MiB> (the
# fixture's size by default), or without Colima the current Docker context as it is found.
ensure_docker() {
	command -v docker >/dev/null 2>&1 || die "docker CLI not found, see docs/testing.md"
	if command -v colima >/dev/null 2>&1; then
		colima_start_sized "${1:-${fixture_size[0]}}" "${2:-${fixture_size[1]}}"
	fi
	docker info >/dev/null 2>&1 || die "no Docker engine reachable, see docs/testing.md"
}

fixture_running() { [ -n "$(compose ps -q distro 2>/dev/null)" ]; }

# Builds the image; the one a change of the Dockerfile replaced is removed, so the VM keeps one
# image. Its untagged layers are the build cache (no BuildKit here): kept, a rebuild without
# changes downloads nothing.
build_image() {
	local before after
	before=$(docker images -q "$image" 2>/dev/null)
	compose build || return
	after=$(docker images -q "$image")
	if [ -n "$before" ] && [ "$before" != "$after" ]; then
		docker rmi "$before" >/dev/null 2>&1 || true
	fi
}

require_fixture() { fixture_running || die "fixture not running: scripts/container-fixture.sh up"; }

wait_ready() {
	for _ in $(seq 1 30); do
		in_fixture test -f /tmp/fixture-ready >/dev/null 2>&1 && return
		sleep 1
	done
	die "fixture not ready within 30 s: docker compose -f tests/container/docker-compose.yml logs"
}

cmd_up() {
	ensure_docker
	log "Building and starting the fixture"
	build_image
	compose up -d
	wait_ready
	log "Ready: $project ($(in_fixture uname -m))"
}

cmd_shell() {
	require_fixture
	compose exec distro bash
}

# One burst of writes, as an agent makes: an edit to a tracked file, a new file, and a write under
# an ignored folder that must not count as a change.
cmd_edit() {
	require_fixture
	in_fixture sh -ec '
		stamp=$(date +%H:%M:%S)
		printf "// edited at %s\n" "$stamp" >>src/cart.ts
		mkdir -p notes
		printf "Written at %s.\n" "$stamp" >"notes/note-$(date +%H%M%S).md"
		printf "rebuilt at %s\n" "$stamp" >build/out.js
	'
	log "Edited src/cart.ts, added a note in notes/, rewrote build/out.js (ignored)"
}

cmd_watch() {
	require_fixture
	log "inotify events in $project (objects and logs of .git left out)"
	compose exec distro inotifywait -m -r -q \
		-e modify,create,delete,move \
		--exclude '/\.git/(objects|logs)/' \
		"$project"
}

# The core's and the helper's tests on Linux (inotify, Linux git), built in the fixture's image
# with the Mac's crate sources. The VM grows for the build and is left as it was found whatever
# happens: stopped, or back to its size with the fixture started again if it was running.
cmd_test() {
	local engine_was_up=false was_running=false
	if docker info >/dev/null 2>&1; then
		engine_was_up=true
		fixture_running && was_running=true
	fi
	ensure_docker "${build_size[@]}"
	local status=0
	build_and_test "$@" || status=$?
	if ! $engine_was_up && command -v colima >/dev/null 2>&1; then
		log "Stopping the Colima VM '$colima_profile', as it was found"
		stop_vm
		return "$status"
	fi
	ensure_docker
	if $was_running; then
		compose up -d
		wait_ready
	fi
	return "$status"
}

build_and_test() {
	log "Building the image"
	build_image || return
	mkdir -p "$linux_target" "$HOME/.cargo/registry"
	log "Testing sidekyk-core and sidekyk-agent on Linux (builds in src-tauri/target/linux)"
	compose run --rm -T --no-deps \
		-v "$repo_root:/src:ro" \
		-v "$linux_target:/target" \
		-v "$HOME/.cargo/registry:/opt/cargo/registry" \
		-e CARGO_TARGET_DIR=/target \
		-w /src/src-tauri \
		distro cargo test --locked -p sidekyk-core -p sidekyk-agent "$@"
}

# The helper end to end in the fixture (src-tauri/crates/agent/tests/container.rs): installed as
# in a WSL distro, then reading, watching and closing once idle.
cmd_helper() {
	set -- "${1:-$linux_target/debug/sidekyk-agent}"
	[ -f "$1" ] || die "no helper at $1: scripts/container-fixture.sh test builds one"
	require_fixture
	local helper
	helper="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
	SIDEKYK_CONTAINER=$(compose ps -q distro) SIDEKYK_LINUX_HELPER="$helper" \
		cargo test --manifest-path "$repo_root/src-tauri/Cargo.toml" -p sidekyk-agent --test container \
		-- --ignored --nocapture
}

cmd_status() {
	if ! docker info >/dev/null 2>&1; then
		log "Docker engine: not reachable"
		return
	fi
	log "Docker engine: $(docker context show)"
	if ! fixture_running; then
		log "Fixture: not running"
		return
	fi
	log "Fixture: running ($(in_fixture uname -m))"
	in_fixture git status --short --branch
}

cmd_clean() {
	log "Removing $linux_target ($(du -sh "$linux_target" 2>/dev/null | cut -f1 || echo empty))"
	rm -rf "$linux_target"
}

cmd_down() {
	if docker info >/dev/null 2>&1; then
		log "Removing the fixture and its repository"
		compose down -v
	fi
	if [ "${1:-}" = "--colima" ] && command -v colima >/dev/null 2>&1; then
		log "Stopping the Colima VM '$colima_profile'"
		stop_vm
	fi
}

case "${1:-}" in
up) cmd_up ;;
shell) cmd_shell ;;
edit) cmd_edit ;;
watch) cmd_watch ;;
status) cmd_status ;;
test)
	shift
	cmd_test "$@"
	;;
helper) cmd_helper "${2:-}" ;;
clean) cmd_clean ;;
down) cmd_down "${2:-}" ;;
"" | -h | --help | help) usage ;;
*)
	usage >&2
	exit 1
	;;
esac
