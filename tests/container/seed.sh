#!/bin/sh
# Creates the demo repository on first start, then marks the fixture ready. The repository lives
# on a named volume: it survives `docker compose restart` and goes with `down -v`.
set -eu

project=/home/ubuntu/project
ready=/tmp/fixture-ready

if [ ! -d "$project/.git" ]; then
	cd "$project"
	git init -q -b main
	git config user.name "Fixture"
	git config user.email "fixture@example.invalid"

	mkdir -p src docs build
	printf 'node_modules/\nbuild/\n' >.gitignore
	printf '# Demo\n\nA repository for the container fixture.\n' >README.md
	printf 'export function total(items) {\n  return items.reduce((sum, item) => sum + item.price, 0);\n}\n' >src/cart.ts
	printf 'export const currency = "EUR";\n' >src/config.ts
	printf 'Old notes.\n' >docs/old.md
	git add -A
	git commit -q -m "Initial commit"

	printf 'export function format(value) {\n  return value.toFixed(2);\n}\n' >src/format.ts
	git add src/format.ts
	git commit -q -m "Add format"

	# One change of each kind the app shows.
	printf '\nexport function count(items) {\n  return items.length;\n}\n' >>src/cart.ts
	printf 'export const currency = "USD";\n' >src/config.ts
	git add src/config.ts
	git rm -q docs/old.md
	printf 'export const tax = 0.22;\n' >src/tax.ts
	printf 'ignored output\n' >build/out.js
fi

touch "$ready"
