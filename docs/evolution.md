# Evolution: from a changes viewer to a project workspace

Direction agreed 2026-10-11: decisions taken, their reasons, and what is left open. Order of work:
`ROADMAP.md`. How built parts work: `architecture.md`.

## Why and guardrails

Needs around watching an agent: explore the repository, take notes per project, switch between
projects (several agents, several repositories).

- Repositories stay read-only; editing happens in the editor. Sidekyk is not an editor.
- The main gesture stays one keystroke away: bring the window up, see the changes, copy a hunk.
- The performance golden rule applies to every panel.

## Layout: semantic zoom

Levels: 0 all projects (cards, doubling as the switcher), 1 a project's panels as tiles, 2 one
panel full screen. A free canvas (React Flow) was rejected: wheel conflicts between pan and
scroll, focus and text in a scaled layer, every panel rendering live when zoomed out. Panels are
independent modules, so a canvas could later be another layout over them (revisit after use).

## Approved mock

`.local/mocks/workspace.html` (local, not versioned), frozen for the MVP 2026-10-12. Its glyphs
are placeholders for Tabler's. Decisions still to build are marked *(to build)*.

Workspace:

- Breadcrumb (All projects / project / panel) is the only "where am I"; project rail on the left.
- Level 0 card: branch, changed files with counts, waiting notes with the newest; ⋯ removes the
  project (repository untouched). Once notes exist, removing must not lose them silently (undo,
  or keep until re-added).
- Tiles are the only level 1 layout (tabs dropped 2026-10-13). Changes left; Files (and Notes)
  right. Splitter between Changes and Files (2026-10-17): it drags the tree's width, the same
  setting as full screen (one value, as VS Code's sidebar), double click fits as the tree's own
  splitter; Changes keeps 560 px, Files gives way first down to 160 px. *(to build, with Notes)*
  splitter between Files and Notes; Files and Notes minimize to a chip in the top bar; each
  project keeps its tiles.
- Every sidebar resizes the same way (2026-10-17): Changes' list, Files' tree, Notes' lists. Drag;
  double click fits what it shows, again goes back; the content beside keeps 240 px; one width per
  sidebar, the same in a tile and full screen, stored in the settings (`sidebarWidths`).
- Panel headers: icon in a tile (title and key in the tooltip; 2026-10-17, the title repeated
  what the panel shows), what is open, icon actions. No header full screen when empty.
- Copy is one icon everywhere, its tooltip says what it copies, a check once done.
- Keys: `↵`/`Esc` zoom (`Esc` progressive: field, menu, mode, then zoom), `1`/`2`/`3` panels,
  `[`/`]` projects, `⌘`+scroll and pinch zoom under the pointer (`Ctrl` on Linux/Windows).
- The palette is the only search; panels have no filter. `⌘K` goes by name (projects, panels, the
  project's files, notes, note lists), `⌘F` finds in the project's files, its open file first
  (2026-10-17: one key for "find" rather than an editor's in-file `⌘F` plus project `⌘⇧F`; the
  find bar over the viewer covers the in-file case). With a file open `⌘F` opens its find bar,
  empty, matches from the top; `⌘F` again from the bar takes its text to the palette.
- Toasts for passing events (bottom center, max three; errors stay); lasting problems in the top
  bar with their fix.
- Theme dark by default, light in settings; no system following.
- Settings: modal (`⌘,`, gear), applies at once. Appearance, Diff (view, scrollbar width, context
  lines), Notes (long lines, Drive sync), Shortcuts.

Changes:

- Diff in either view, copy with a click through the user's template (built).
- *(to build)* Scrollbar as a map: one mark per hunk (added/removed/both) under a translucent
  thumb; click a mark to go there. Narrow or wide in settings.
- *(to build)* `n`/`p` next/previous change, across files.

Files (built 2026-10-17):

- Tree as VS Code's: folders first, compact folders, change colors (amber, green new; folder takes
  the strongest) with words in the tooltip, never a horizontal scrollbar.
- In a tile the tree alone; Changes is the one viewer (an unchanged file shows as its text). Full
  screen, tree + viewer.
- One selection for both panels, as VS Code's explorer follows the editor (revised 2026-10-17; the
  mock kept them apart). A commit's file leaves the tree alone.
- Tree width as every sidebar's (Workspace); the fit takes the open rows.

Notes *(to build)*:

- Cards, not documents: plain text, user's order (new on top), each marked done when used. Done
  cards fold into "Done (n)".
- Actions on the card, never in its text: done circle left; copy and ⋯ top right. ⋯: move to top,
  reorder, move to another list, delete (move and delete undoable).
- Edit in place: four lines shown (line count if longer), all when clicked; `Esc`, `⌘↵` or click
  outside closes; an empty card goes. Long lines wrap or scroll (setting, `⌥Z`).
- Field on top adds to the open list: `↵` adds, `⇧↵` new line, paste into the empty field adds at
  once; `⌘N` focuses it.
- Lists per project by topic; full screen on the left, in a tile a menu from the header. "New
  list" first; double click renames; deleting takes its notes (undo). A project opens on the list
  last open.
- Order without drag and drop: "Move to top", and "Reorder…" (one line per card with ↑, position,
  ↓; a typed position for long jumps; `⌥↑`/`⌥↓` move, `↑`/`↓` select; `Esc`/`↵` leave). Done
  cards stay by when done.

Not taken:

- Naming the agent at work; "last changed 40s ago" on cards (no source without watching every
  project).
- Tabs at level 1 (2026-10-13).
- Long structured notes (revisit if needed); a filter in Files.
- A dot on the tray icon for hidden changes (always on while an agent works; 2026-10-14).
- Comparing against the default branch / merge base (2026-10-14): Changes compares against HEAD
  as VS Code and Zed do; commits are looked at in the recent commits.

## Follow the terminal: dropped (2026-10-16)

No automatic switch to the project of the terminal tab used last; switching stays manual (`[`/`]`,
`⌘K`, rail, `sidekyk .`). Every signal breaks on some axis (agent, terminal, shell, tmux, OS):
terminal APIs (one adapter per terminal, settings to enable, blind under tmux; built for kitty on
macOS, then dropped), agent hooks (not every agent), shell hooks (silent while the agent runs),
tty access time (unchanged on macOS; no ttys on Windows), window titles (permissions on macOS,
overwritten by agents). Kept in mind: follow the activity (project whose files changed last), if
the manual switch proves not enough.

## Ideas from tazly

Taken: rail of other projects, one command bar, `Esc` cancels before navigating, notes with copy,
`⌥` shortcuts matched on `e.code`. To evaluate: quick capture of a note via a global shortcut; a
`PRODUCT.md`. Not taken: layered glass blur (GPU), rich-text editors.

## UI components (2026-10-12)

Base UI (`@base-ui/react`, pinned 1.8.0) for palette, menus, selects, tooltips, toasts: maintained,
1.x, headless, virtualizes with `@tanstack/react-virtual`. Compared (kB gzip, palette/tooltip):
Base UI 42/34, Radix+cmdk 19.5/21 (Radix slowing, cmdk no virtualization), Headless UI 54/none,
Ariakit 38/35 (0.x), Ark 48/25, React Aria 56/22. Positioning (floating-ui) is the shared 20-35 kB.
CSS-only tooltips cannot flip; anchor positioning unconfirmed on WebKitGTK. Never in the first
paint chunk.

## Projects

- Project list is app data next to the settings; only the project on screen is watched and runs
  full snapshots.
- Others show a summary (status + numstat vs HEAD, new files counted not read), the same numbers
  a snapshot gives.
- Not watched (2026-10-13): level 0 reads summaries each time it shows (~65 ms, 0.4 s CPU for ten
  repos). A watcher per project is cheap on FSEvents/Windows but on inotify means one watch per
  directory (~33,000 for those repos); revisit if real-time cards are missed.
- On show (2026-10-14) read only what may have changed: the watched project if marked while
  hidden, anything older than 30 s. 30 s because of the review loop (`⌘Tab` every 5-30 s: reading
  ten projects each return is ~140 s CPU/hour, 30 s caps it at ~50 s) while another agent's count
  is at most one turn stale. No debounce on show.
- Inactive projects' caches expire (`gcTime`).

## Beyond developers: folders without git (direction 2026-10-17)

- A project may be any folder (documents of any kind), for users who are not developers; git
  optional. Without git: no Changes, summary counts, recent commits or tray count; Files and Notes
  are the panels.
- Already free of git: the tree (`FileTree` from a path list), the file viewer (`read_entry`), the
  palette's ranking, notes. Tied to git: Changes, snapshot/summary, commits, tray count, the
  watcher's filter (`check-ignore`), the file list (`git ls-files`), opening a project
  (`not_a_repository`).
- Rule from now: what does not need git does not use it. Content search runs in-process over a
  file list; the file list sits behind a port (`ignore`, ripgrep's walker, the candidate without
  git).
- Open: two templates (developer / everyday) chosen by the user, or panels derived per project
  (git → Changes), the template at most a global preference hiding developer parts (leaning to
  derived); level 0 card without git; watcher filter without git (`.gitignore`/`.ignore` rules);
  documents (PDF, Office) need text extraction and likely an index (`tantivy`), i.e. work in the
  background against the golden rule: a separate decision, with measures.

## Explorer

- Tree from `git ls-files` (`.gitignore` applies); deleted tracked files left out (Changes lists
  them). Read-only tree on the virtualizer, no tree library.
- 2026-10-17: the backend keeps the list and serves open folders, so the payload is what is open.
  Files is the second panel of the repository module (once `changes`), sharing its viewer.
- Search by name in `⌘K` (built 2026-10-17): the project on screen only, never other projects'
  files (switching project is searching its name); none at level 0, which would mean every
  project. Change shown as a quiet word, not a colored name.
- Search in contents (built 2026-10-17): in-process over a file list, not `git grep`, so it also
  serves folders without git and notes. `grep-searcher` + `grep-regex` chosen over our own loop on
  `regex` + `memchr`: same time and CPU on Zed's clone (36-41 ms, ~0.28 s CPU on 8 threads; the
  cost is reading files), 4.7-5.8 MB peak against 20-25 MB (whole files in memory), and other
  encodings. Hence: narrowing, a line limit, a typing pause.
- Libraries chosen at implementation time with pros and cons (`AGENTS.md`).

## Notes storage and sync

- Stored at application level in the app data dir (`io.github.gualask.sidekyk` under
  `~/Library/Application Support`, `~/.local/share`, `%APPDATA%`), never in repositories: per
  project its lists and notes (text, list, position, edited, done).
- Format and granularity at implementation; one file per note is natural and keeps conflicts
  small.
- Optional Google Drive sync, nothing leaves the machine without an account. Facts checked
  2026-10-11:
  - Scopes: `drive.appdata` (hidden app folder) or `drive.file` (files visible in Drive), both
    non-sensitive.
  - Desktop OAuth: "Desktop app" client, loopback redirect on a random port, PKCE S256; the client
    secret is not secret; OOB and custom schemes unsupported.
  - Refresh tokens expire after 7 days while the Cloud project is "Testing"; real use needs
    "Production". They also die on revocation, six months unused, or past 100 per account.
  - Tokens in the OS credential store only; on Linux without a Secret Service, sync stays off.
- Constraints: local first, sync in the background after edits (debounced), at startup and on
  focus, never polling; network only in Rust; conflicts keep both versions; consider client-side
  encryption.

## Fuzzy matching (2026-10-13)

`nucleo-matcher` 0.3 in Rust (fzf scoring, path mode, MPL-2.0 per file: unmodified in an MIT app,
notice shipped). Zed, nushell, Rerun use it. Alternatives: `frizbee` (faster, MIT, but monthly
breaking releases, no path mode), `fuzzy-matcher` (unmaintained). Speed does not decide; ranking
and a stable API do. Behind `modules/search/rank.rs`.

## Global shortcut (2026-10-15)

- macOS/Windows: `tauri-plugin-global-shortcut` (`global-hotkey`: Carbon `RegisterEventHotKey`,
  `RegisterHotKey`), idle until pressed, no permission. Rejected: `handy-keys` (sees every key,
  Accessibility permission), `livesplit-hotkey`.
- Linux: `global-hotkey`'s X11 backend wakes every 50 ms and Wayland has none, so the desktop's
  shortcut runs `sidekyk --toggle` (single instance).
- Shows the window when hidden/minimized/behind, hides it in front (on macOS the whole app).
- Combination: a modifier (`⌘`/`Win`, `Ctrl`, `⌥`/`Alt`) plus letter, digit or named key, or
  F1-F20 alone; no punctuation (codes name US keys). Checked in the backend.
- Conflicts: refused ones keep the previous; macOS accepts duplicates silently, so its own
  shortcuts are read (`CopySymbolicHotKeys`) to warn. `⌥`-only shortcuts work on macOS 27.

## What changes in the rules

When notes and sync land, `AGENTS.md` says: repositories are never written, app data is; sync is
the first network access, backend only.

## Open decisions

- Notes: format and granularity.
- Sync: `drive.appdata` or `drive.file`; conflict strategy; client-side encryption.
- Folders without git: templates or derived panels; documents' text and an index (see Beyond
  developers).
- Quick capture of a note via a global shortcut.
- Global shortcut default (`⌃⌥Space` for now; taken by "next input source" with two input
  sources; `⌥Space` is Raycast's and Alfred's).
- Free canvas, after semantic zoom has been used.

## Sources

- [Choose Google Drive API scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)
- [Store application-specific data (appDataFolder)](https://developers.google.com/workspace/drive/api/guides/appdata)
- [OAuth 2.0 for iOS & desktop apps](https://developers.google.com/identity/protocols/oauth2/native-app)
- [Using OAuth 2.0 to access Google APIs: refresh token expiration](https://developers.google.com/identity/protocols/oauth2)
