#!/usr/bin/env bash
# Drives the container fixture (tests/container): a Linux box that stands in for a WSL distro.
# See docs/container-testing.md. A bare invocation prints usage and does nothing else.
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
fixture_dir="$repo_root/tests/container"
project=/home/ubuntu/project

# A Colima VM of its own, as small as the fixture allows (sizes and measures in
# docs/container-testing.md). Given only when the VM is created: Colima refuses a smaller disk than
# the VM has.
colima_profile=sidekyk
colima_resources=(--cpu 1 --memory 0.5 --disk 1 --root-disk 4)
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
  down [--colima] remove the fixture and its repository; --colima also stops the VM

Without Colima, the current Docker context is used.

The repository is $project on a named volume: it survives restarts of the
fixture and of Colima; only 'down' removes it.
EOF
}

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

# ensure_docker makes `docker info` answer: the fixture's own Colima VM, started (created with its
# resources on first run), or without Colima the current Docker context as it is found.
ensure_docker() {
	command -v docker >/dev/null 2>&1 || die "docker CLI not found, see docs/container-testing.md"
	docker info >/dev/null 2>&1 && return

	command -v colima >/dev/null 2>&1 || die "no Docker engine reachable, see docs/container-testing.md"
	if colima_exists; then
		log "Starting the Colima VM '$colima_profile'"
		colima_keeping_context start --profile "$colima_profile"
	else
		log "Creating the Colima VM '$colima_profile'"
		colima_keeping_context start --profile "$colima_profile" "${colima_resources[@]}"
	fi
	docker info >/dev/null 2>&1 || die "Docker engine did not come up"
}

fixture_running() { [ -n "$(compose ps -q distro 2>/dev/null)" ]; }

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
	compose up -d --build
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

cmd_down() {
	if docker info >/dev/null 2>&1; then
		log "Removing the fixture and its repository"
		compose down -v
	fi
	if [ "${1:-}" = "--colima" ] && command -v colima >/dev/null 2>&1; then
		log "Stopping the Colima VM '$colima_profile'"
		colima_keeping_context stop --profile "$colima_profile"
	fi
}

case "${1:-}" in
up) cmd_up ;;
shell) cmd_shell ;;
edit) cmd_edit ;;
watch) cmd_watch ;;
status) cmd_status ;;
down) cmd_down "${2:-}" ;;
"" | -h | --help | help) usage ;;
*)
	usage >&2
	exit 1
	;;
esac
