# Evolution: from a changes viewer to a project workspace

Direction agreed on 2026-10-11. This file records what Sidekyk grows into, the decisions already
taken and the ones left for implementation time. The steps and their order are in `ROADMAP.md`.

## Why

Sidekyk exists to watch what a coding agent touches in a repository. Around that, three more needs
come up while working with agents:

1. **Explore the repository** beyond the changes: find a file and read it.
2. **Take notes** on a project.
3. **Switch between projects**, since several agents can work on several repositories.

## Guardrails

- **Repositories stay read-only.** The explorer shows files; editing happens in the editor ("open
  in editor"). Sidekyk is not becoming an editor.
- **The main gesture stays one keystroke away**: bring the window up, see the changes, copy a hunk.
  No new layer of navigation may slow it down.
- **The performance golden rule applies to every panel** (`AGENTS.md`).

## Layout: semantic zoom, not a free canvas

Three fixed levels, with animated transitions that give the feeling of zooming:

| Level | Shows |
|---|---|
| 0, all projects | One card per project: changes in progress, a glimpse of the notes. It doubles as the project switcher |
| 1, a project | Its panels (Changes, Files, Notes, …) as tiles |
| 2, one panel | A single panel full screen, as the app is today |

Navigation is by keyboard and shortcuts, and a new panel finds its place without a layout to
design.

**Why not a Figma-like free canvas**: it is feasible (React Flow / xyflow, MIT, is battle-tested),
but its cost is in the details: the wheel both pans the canvas and scrolls inside panels, text
selection and focus inside a scaled layer, text rasterized at scales other than 1, trackpad
gestures in WKWebView. With 3-5 panel types, spatial memory helps little and every visit pays for
the navigation. Performance is the other reason: zoomed out, every panel would render live, and the
canvas would need a level-of-detail scheme. Level 0 shows summaries only, so the problem never
arises.

**Revisit** after using semantic zoom: since panels are independent modules, a free canvas would
be a different layout over the same panels, not a rewrite.

## Approved mock

A clickable mock of the three levels was approved on 2026-10-11, refined with the maintainer and
frozen for the MVP on 2026-10-12. It is a single HTML file kept locally in
`.local/mocks/workspace.html` (not versioned); its glyphs and SVG icons are placeholders for
Tabler's. What it settles:

### Workspace

- **Where you are**: the breadcrumb (All projects / project / panel) is enough; no separate
  zoom-level indicator.
- **Project rail** on the left of a project: the "all projects" button first, then one avatar per
  project with its change count, so switching does not need a trip to level 0.
- **Level 0 cards**: branch, changed files with line counts (of tracked files, see Projects),
  and how many notes wait, with the
  newest. A card's ⋯ menu removes the project from Sidekyk, as a note's removes the note; its
  repository is left as it is. "+ Add a repository", the last card, adds one. Removing asks
  nothing and loses nothing while a project is only its repository; once notes belong to
  projects, it must not delete them silently (undo, or keep them until the project is added
  again).
- **Tiles** at level 1, the only layout (tabs were dropped on 2026-10-13, see Not taken).
  Tiles put Changes on the left, Files above Notes on the right; the splitters drag, a double
  click resets them. Files and Notes minimize to a chip in the top bar, and the other takes the
  room. Each project keeps its own tiles.
- **Panel headers** stay light: the panel's title, what is open in it, and icons; minimize and
  zoom always shown. The panel's key is in the tooltips, not a badge. Full screen, a panel with
  nothing to show in its header has none.
- **Copy** is one icon everywhere (hunk, file, path, note), with no label: its tooltip says what it
  copies, and it turns into a check for a moment once done.
- **Keyboard**: `↵` zooms in and `Esc` zooms out; `Esc` is progressive (it first leaves a field,
  closes a menu or leaves a mode, then zooms out); `1`/`2`/`3` open Changes, Files, Notes; `[`/`]`
  switch project; `⌘`+scroll and trackpad pinch zoom on the element under the pointer (`⌘` is
  `Ctrl` on Linux and Windows, here and below).
- **Command palette** (`⌘K`): projects, panels, files of every project, notes, note lists. It is
  the only search: panels have no filter of their own. Inside a project its files come first.
- **Toasts** for passing events, bottom center, at most three; information leaves by itself, an
  error stays until closed or acted on. **Problems that last** (sync stopped) are not toasts: a
  warning in the top bar lists them, each with its fix.
- **Theme**: dark by default, light chosen in the settings. The app no longer follows the system.
- **Settings**: a small modal dialog, opened from a gear in the top bar and with `⌘,`; changes
  apply at once, `Esc` or a click outside closes it. Sections: Appearance (theme), Diff (the view
  a diff opens in, the scrollbar's width, context lines later), Notes (long lines, Google Drive
  sync), and Shortcuts (the global shortcut).
  Same dialog component as the palette.

### Changes

- **The diff** shows only the changed lines, or the whole file with the changes marked ("Full
  file", which opens on the current or first change); the header switches it, and the settings
  choose the default. In the whole file a hunk is outlined on hover, its copy at its top right.
- **The scrollbar is a map of the changes**: one mark per hunk at its place (added, removed or
  both), under a translucent thumb; a click on a mark goes to that change, elsewhere jumps there,
  the thumb drags. Narrow or wide, in the settings.
- **`n`/`p`** go to the next or previous change, on to the next or previous file at either end;
  `↑`/`↓` and `j`/`k` move between files.

### Files

- **A tree**, folders first, as in VS Code: `→` opens a folder or goes into it, `←` closes it or
  goes up, `↑`/`↓` move, `↵` opens (full screen; `j`/`k` in a tile too). A folder holding only one
  folder shares its row with it ("modules/changes"). Open folders and the selection are kept per
  project.
- **Changes color the name**, as in VS Code, with no letter or mark: modified in amber, new in
  green; a folder takes the color of the strongest change inside it, and the tooltip says it in
  words.
- **The tree's width** is dragged, and kept. A double click on its edge widens it to fit every
  open row, for a look at a deep tree, and a second one brings it back. Never a horizontal
  scrollbar: a row that does not fit ends in "…", its full path in the tooltip; the file view
  keeps at least 240 px.
- **A file opened from `⌘K`** is shown in the tree: the folders above it open and it is selected.
- **A changed file** shows the whole file with its changes marked, on the viewer of Changes (the
  same rows, scrollbar marks and hunk copy), starting at its first change; other files show their
  text. One viewer, not two.
- **Changes and Files are not kept in sync**: moving through changes would drag the tree away from
  where it was, and with tiles the same file would show twice. Each header links to the other
  instead, at the same change: "Show in Changes" in Files, "Show in Files" in Changes (the file
  revealed in the tree). An opt-in setting to follow the selection can come later, if missed.

### Notes

- **Cards, not documents**: plain text, one card each, in the order the user gives them (a new
  card goes on top). They hold things to try and what the agent said, to paste back later; both
  are used once and then done, so a card is marked done, whatever it holds.
- **What a card does is on the card**, never inside its text: a circle on the left for done; copy
  and a ⋯ menu always shown in the top right corner, ⋯ in the corner itself. The menu moves the
  card to the top, reorders the list, moves the card to another list (to its top) or deletes it;
  moving and deleting can be undone. Done cards fold into "Done (n)" at the bottom.
- **Editing** happens in place: a card shows four lines (and its line count when longer), all of
  it once clicked; `Esc`, `⌘↵` or a click outside closes it, and a card left empty goes. Long
  lines wrap or scroll sideways, as in VS Code: a setting, switched with `⌥Z`.
- **A field on top** of the cards adds one to the open list: `↵` adds what was typed (`⇧↵` for a
  new line), and pasting into the empty field adds a card at once. `⌘N` focuses it.
- **Lists** keep a project's notes apart by topic (General, Architecture, Observability…); a card
  is in one list. Full screen, the lists are on the left; in a tile, the header's list name opens
  them as a menu. "New list" comes first in both, so it is never a scroll away; a double click
  renames a list; deleting one takes its notes, with undo. Each list has its own "Done". A
  project opens on the list last open in it, not the one edited last: things are found where
  they were left.
- **Order without drag and drop**: "Move to top" covers the usual case in one click. "Reorder…"
  enters a mode where the list shows one line per card, each with ↑, its position and ↓ (as in
  fyler): a click on the position takes a number typed in, for long jumps; `⌥↑`/`⌥↓` move the
  selected card, `↑`/`↓` select; `Esc`, `↵` or "Done" leave the mode. Only open cards are
  ordered; done ones stay by when they were done.
- **`⌘K`** finds notes by their text too, and lists by name.

### Not taken

- Naming the agent at work ("Claude Code · 40s ago", in the first version). Sidekyk sees file
  changes, not who made them.
- When files last changed on the cards ("40s ago", pulsing while an agent writes). Without a
  watcher on every project (see Projects) it has no source for the projects not on screen, and
  it is not worth one.
- Tabs at level 1, as a layout to choose instead of the tiles in the settings. Dropped on
  2026-10-13: the tiles are enough, and one layout keeps the code, the settings and the
  keyboard model simpler.
- Long structured notes (a document with headings). They fit in a card for now; revisit if the
  need shows up in use.
- A filter in the Files panel, and a flat list of results in it: `⌘K` is the search.
- A dot on the tray's icon when the project on screen changes while the window is hidden. Dropped
  on 2026-10-14: while an agent works it is always on, so it tells nothing, and it cannot say
  which project changed.
- Comparing against the default branch (the merge base with `main`), to keep an agent's commits
  in view. Dropped on 2026-10-14: Changes compares against HEAD, as VS Code and Zed do, and what
  was committed is looked at in the recent commits instead.

## Follow the terminal: dropped

Decided with the maintainer on 2026-10-16: no automatic switch to the project of the terminal tab
used just before. Switching stays manual and fast: `[`/`]`, `⌘K`, the rail, and `sidekyk .` from
the tab (an alias away), which opens that tab's repository in the running app.

The idea was: each terminal tab runs an agent in its repository, and Sidekyk, brought up from
anywhere, opens on the project of the tab used last. The only thing every setup shares is that a
terminal is used; the agent (Claude Code, Codex, opencode…), the terminal, the shell, tmux and the
system all vary. Every signal for "the tab used last" holds on one of these and breaks on another:

- **The terminal's API** (kitty's remote control, WezTerm's CLI, iTerm2's AppleScript): any agent
  and shell, but one adapter per terminal, a setting to turn on in each (kitty needs
  `allow_remote_control` and `listen_on`, then a restart), none for Windows Terminal or on
  Wayland, and under tmux the terminal sees the tmux client, not the pane. Built and working on
  macOS with kitty (the app in front from `CGWindowListCopyWindowInfo`, kitty's socket from
  `libproc`, its protocol spoken directly), then dropped for this reason.
- **The agent's hooks** (Claude Code's `UserPromptSubmit`): any terminal and system, but not every
  agent has them (Codex, opencode).
- **A shell hook** (`precmd`, `PROMPT_COMMAND`): any terminal, but the shell is silent while the
  agent runs in its tab, which is when it matters.
- **The tty's last input** (its access time, which `w` reads for the idle time): any terminal,
  agent and shell on Linux, but checked on macOS 27: input read from a pty leaves its access time
  unchanged, so it says nothing there; Windows has no ttys.
- **The window title**: most terminals show the active tab's, but macOS needs the screen
  recording or accessibility permission to read it, and agents overwrite it.

Kept in mind, not planned: **following the activity**, the project whose files changed last when
Sidekyk comes up. It needs nothing from the agent, the terminal or the system, but answers "where
is an agent writing", not "which tab did I look at": with two agents at work, the last to write
wins. To weigh once real use says the manual switch is not enough.

## Ideas from tazly

tazly (`../tazly`, a Chrome new-tab board of projects, tasks and notes) tried a similar workspace.
Worth taking:

- the focus mode with a sidebar of the other projects (now the project rail);
- a single command bar as the entry point for everything (now `⌘K`);
- "`Esc` cancels, it does not navigate" (now the progressive `Esc`);
- per-project notes with "copy all" (now a note's copy icon);
- **quick capture**: a global shortcut that adds a note to the active project without opening the
  window, as tazly's page widget did. To evaluate with the notes;
- a `PRODUCT.md` with users, purpose and design principles, as tazly has;
- `⌥` shortcuts matched on `e.code`, since on macOS `⌥`+letter types a special character in
  `e.key`.

Not to take: the visionOS-like glass (layered blur costs GPU, against the golden rule), and a
rich-text editor such as Lexical: notes are plain-text cards.

## Panels

- One module per panel under `src/modules/` (as `changes` is today), exposing a common contract:
  id, title, icon, component, and a summary for level 0. `app` composes them; modules still never
  import each other, and `pnpm boundaries:check` keeps enforcing it.
- A panel that is not on screen does no work: its queries are disabled (`enabled`) and its code
  is loaded lazily, one chunk per panel module.

## UI components

The mock needs widgets that are costly to get right by hand: a command palette (a combobox in a
dialog, with keyboard navigation, focus trap and screen reader support), menus (a note's ⋯, the
note lists in a tile), tooltips, and later the settings' controls (switch, select, number field).
Evaluated on 2026-10-11.

**Libraries compared**, on realistic components, minified, React excluded, each measured alone
(kB gzip; the app's JS is 95 kB gzip today):

| Library | Palette | Tooltip |
|---|---|---|
| Base UI 1.8 | 42.0 | 33.8 |
| Radix (one package each) + cmdk | 19.5 (cmdk) | 21.0 |
| Headless UI 2.2 | 53.6 | none |
| Ariakit 0.4 | 38.1 | 34.5 |
| Ark UI 5.39 | 48.1 | 25.3 |
| React Aria Components 1.22 | 56.0 | 21.7 |

- **Positioning is the cost**: a tooltip, menu or select must stay attached to its trigger, flip
  at the window's edges and follow scrolling. Every library does it with a positioning engine
  (mostly floating-ui) of 20-35 kB, paid once. Base UI's palette (Autocomplete `inline` in a
  Dialog, centered) does not use it.
- **Marginal cost in Base UI**: a tooltip adds 20.7 kB to the palette alone, but 4.2 kB to a menu
  and 4.4 kB to palette + menu + select (75.0 → 79.4 kB), since they share the engine.
- **Radix + cmdk** is the lightest, but Radix's development has slowed (its authors build Base
  UI) and cmdk does not virtualize (with thousands of files, show only the top matches).
  Headless UI has no tooltip and a heavier palette; Ariakit is 0.x with one main maintainer; Ark
  UI and React Aria are heavier.
- **Base UI**: actively maintained, 1.x, MIT, headless (takes the `--ui-*` tokens and Tailwind),
  one import path per component; Autocomplete supports virtualization with
  `@tanstack/react-virtual`, already a dependency; used in `../irc-news`. It targets Baseline
  Widely Available features, which WKWebView, WebKitGTK and WebView2 have; to confirm on Linux.
- **Native**: a CSS-only tooltip cannot flip or stay on screen, so it is not an option. The
  native `title` is placed by the system but cannot be styled. CSS anchor positioning would
  replace the engine, but WebKitGTK support is not confirmed (Safari has it since 26).

Decided on 2026-10-12: Base UI (`@base-ui/react`, pinned to 1.8.0) for the palette, menus, selects
and tooltips. None of it is in the first paint's chunk: each overlay comes with the code that first
needs it (the project cards' menu with level 0), or loads once the window is idle after the first
paint, so `⌘K` and the first hover are still instant.

## Projects

- The list of projects is app data, kept with the settings (see Notes for the location). It
  replaces the single "last repository" setting.
- Only the active project runs full snapshots and is watched.
- Decided on 2026-10-12: the other projects show a summary on the rail and on the level 0 cards
  (branch, changed files, lines, the first files), from `git status` and one numstat against
  HEAD, without reading new files. It loads once the first paint is done and again when the
  window comes to the front, never while idle. The snapshot builds the same summary, so a project
  shows the same numbers wherever it is; lines are those of tracked files, new files count as
  files only. Counting new files' lines would mean reading them for every project on screen.
- Decided on 2026-10-13: the projects not on screen are not watched. Level 0 is where one
  chooses a project knowingly, or sees which ones have changes; nobody watches it for changes in
  real time. So the cards read their summaries again each time level 0 shows (measured on the
  ten repositories in `~/Dev`: about 65 ms in parallel, 0.4 s of CPU), which also refreshes the
  counts on the rail, and nothing runs for those projects otherwise.
- Decided on 2026-10-14: when the window shows again, or level 0 does, only what may have
  changed is read again. The project on screen is read when its watcher saw something while the
  window was hidden; the projects not watched, when their summary is older than 30 s; the project
  on screen also past 30 s, as the safety net for what the watcher cannot see. No debounce: it
  would delay the one refresh the user is waiting for. The cases 30 s was chosen on:
  - Flicker: a window dragged over Sidekyk, Mission Control, a swipe between Spaces hide and
    show it within a second or two. Any limit handles them.
  - The review loop, the app's main use: `⌘Tab` between the agent's terminal and Sidekyk every
    5 to 30 s. Read every time, with ten projects at one return every 10 s, it costs about
    140 s of CPU an hour (0.4 s per return); SWR's 5 s (its `focusThrottleInterval`) would not
    reduce it at all. With 30 s it is at most two reads a minute, about 50 s an hour, and
    nothing for the project on screen while the agent writes nothing.
  - Level 0 and back (`Esc`, `↵`) in a few seconds, to look at the cards: read once.
  - Another agent at work on another project: its count on the rail is at most 30 s old when
    the window comes back, less than one turn of an agent, which takes tens of seconds to
    minutes. While the window stays in front, those counts are not read anyway (see above), and
    opening the project reads it at once.
  - Back after a break: always read.

  60 s would halve the cost of the loop again, but the rail could then miss a whole turn of
  another agent.
- Why not a watcher on every project: FSEvents (macOS) and Windows watch a whole tree with one
  handle and cost close to nothing, but inotify (Linux) needs one watch per directory, and
  `notify`'s recursive mode watches them all, ignored ones included: about 33,000 directories
  for those ten repositories (47,000 following links), against about 670 that git does not
  ignore. The limit is per user and shared with the editors, and was 8,192 before Linux 5.11.
  Watching only the directories not ignored would make it light, but it is Linux-only code to
  write and test for numbers that change while nobody looks. Knowing only that "something
  changed" needs the same watches, so it is not cheaper. Revisit if real-time cards are missed
  in use; the Linux watcher of the project on screen needs the same work anyway (`ROADMAP.md`,
  Release).
- Query caches of inactive projects expire (`gcTime`), so memory does not grow with the number of
  projects.

## Explorer

- **Tree**: `git ls-files` plus untracked files (`--others --exclude-standard`), so `.gitignore`
  applies and large repositories list in milliseconds; read again only when files are created or
  deleted. A tracked file deleted from disk is still in the index until staged: the tree leaves it
  out, as VS Code does, and the Changes panel lists it.
- **Tree view**: the frontend builds the tree from the paths and renders only the rows of open
  folders, virtualized (`@tanstack/react-virtual`, already a dependency), with `tree`/`treeitem`
  roles and their level, since rows off screen are not in the DOM. Behaviour as in the approved
  mock. A read-only tree is little code on the virtualizer; tree libraries mostly add drag and
  drop.
- **File view**: read through the backend with a size limit, rendered with the virtualized rows of
  the diff view; a changed file uses the diff view itself, whole file with changes marked. Syntax
  highlighting comes with the item already on the roadmap (loaded lazily).
- **Search by name**: in `⌘K`, fuzzy matching over the path list in the backend, with
  `nucleo-matcher` (decided on 2026-10-13, see Fuzzy matching). The Files panel has no filter of
  its own.
- **Search in contents**: in `⌘K` too, as a mode of the palette; in the backend, with `git grep`
  or ripgrep's crates, streaming results and cancellable when the query changes.
- Each library is chosen at implementation time with pros and cons, per the dependency rule in
  `AGENTS.md`.

## Notes

- **Kept at application level**, never inside repositories: in the app data directory, where
  `settings.json` already lives (Tauri's `app_data_dir`: `~/Library/Application Support/` on
  macOS, `~/.local/share/` on Linux, `%APPDATA%` on Windows, each followed by
  `io.github.gualask.sidekyk`).
- **What is stored**: per project, its lists (name, order, the one last open) and its notes (text,
  list, position, when edited, when done).
- **Decided at implementation time**: the format (JSON, Markdown files, a small database) and
  whether notes are one file or one per note or per project. A note is a card (Approved mock), so
  one file per note is the natural unit, and it keeps sync conflicts small.

### Optional sync with Google Drive

The user may connect a Google account; notes are then synced across machines and backed up.
Without a connected account, nothing leaves the machine and sync costs nothing.

Facts checked on 2026-10-11 (sources below):

- **Scope**: `drive.appdata` gives access to a folder private to the app (`appDataFolder`). Google
  classifies it as non-sensitive and recommended. The alternative, `drive.file`, is also
  non-sensitive and covers files the app creates, which the user also sees in Drive. To decide:
  a hidden backup (`drive.appdata`) or files the user can open (`drive.file`).
- **OAuth for a desktop app**: client type "Desktop app", redirect to a loopback address
  (`127.0.0.1` on a random port, served by a local listener), PKCE with `S256`. The client secret
  ships with the app and Google does not treat it as secret. The copy-and-paste (OOB) flow and
  custom URI schemes are no longer supported for desktop apps.
- **Publishing status**: while the Google Cloud project is in "Testing", refresh tokens expire
  after 7 days. Real use needs the project in "Production". Tokens also stop working when the user
  revokes access, after six months without use, or beyond 100 live tokens per account and client.
- **Where tokens live**: in the OS credential store (Keychain on macOS, Secret Service on Linux,
  Credential Manager on Windows), never in the webview or in a plain file. On Linux a Secret
  Service may be missing (a minimal desktop): then sync cannot be turned on, rather than keeping
  tokens in a file.

Design constraints for the implementation:

- **Local first**: notes are always written locally first; sync runs in the background, after
  edits (debounced), at startup and on window focus. No polling while idle.
- **Network in the Rust backend**: OAuth and Drive calls run there, so tokens never reach the
  frontend and the webview's CSP stays local-only.
- **Conflicts between machines are never resolved by silently dropping an edit**: detect them
  (Drive file revisions against the last synced one) and keep both versions. The exact strategy is
  decided together with the storage format.
- **Privacy**: Drive does not encrypt end to end. Client-side encryption of synced notes is an
  option to weigh.
- **Libraries** (OAuth, HTTP, credential store) are chosen at implementation time with pros and
  cons.

## Fuzzy matching

Decided on 2026-10-13: the palette's matching runs in the backend, with `nucleo-matcher` (Helix's
matcher, MPL-2.0). The scoring must favour consecutive letters and word starts: letters scattered
over a long path or note title match almost any query.

- **`nucleo-matcher` 0.3**: fzf's scoring, a mode for paths (bonuses after `/` and at the start
  of a file name), Unicode normalization, only `memchr` as dependency. Zed moved its file finder
  and command palette to it in April 2026; nushell and Rerun use it too. Releases stopped in 2024,
  the API is stable. MPL-2.0 is a per-file copyleft: fine in an MIT app as long as its files are
  not modified; its notice goes with the binary.
- **`frizbee` 0.13** (MIT): SIMD Smith-Waterman, about 4 times faster than nucleo in its own
  benchmarks (1.4M Chromium paths: 22 ms against 90 ms), optional typo tolerance; television,
  skim, fff and atuin moved to it. A breaking release a month in 2026 and one main maintainer;
  no mode for paths.
- **`fuzzy-matcher`** (skim's, MIT): the most downloaded, unmaintained since 2020. `fff-search`
  is a whole file finder with its own index, in nightly releases.
- Speed does not decide: a project has from hundreds to tens of thousands of paths, a few
  milliseconds per key with nucleo (0.34 ms for 4,366 paths of Zed's clone). The ranking of paths
  and a stable API do. The matcher sits behind `modules/search/rank.rs`, so changing it touches
  one file.

## Global shortcut

Decided on 2026-10-15: a global shortcut shows and hides Sidekyk from any app, on by default.

- **Registered with `tauri-plugin-global-shortcut`** (Tauri's own, Apache-2.0/MIT) on macOS and
  Windows, from Rust only, with no JavaScript API. It wraps `global-hotkey`, which asks the
  system for the one combination: Carbon's `RegisterEventHotKey` on macOS, `RegisterHotKey` on
  Windows. Idle until pressed, with no permission to ask. Rejected: `handy-keys` (every key of the
  system through Sidekyk, Accessibility permission on macOS), `livesplit-hotkey` (little used).
- **Not on Linux**: `global-hotkey`'s X11 backend wakes every 50 ms for as long as the app runs
  (a `poll_for_event` loop with a sleep), and Wayland has no backend (its portal PRs are still
  open). There the desktop's own keyboard settings run `sidekyk --toggle`, which the running
  instance receives through single-instance. It works on X11 and Wayland at no cost, and the
  desktop warns about conflicts itself. The settings give the command to copy.
- **Behaviour**: hidden, minimized or behind other windows, it brings Sidekyk to the front; in
  front, it hides it. On macOS the whole app hides, so the app used before comes back.
- **The setting** (mock: "Show and hide Sidekyk"): a switch, and under it a field that records a
  new combination: at least `⌘`/`Win`, `Ctrl` or `⌥`/`Alt`, then a letter, a digit or a named
  key, or a function key (F1-F20) alone, which takes no character from any app. Punctuation is
  left out: its code names the US layout's key. The backend checks the same rule before it
  registers or stores one (`modules/settings`). While a combination is typed, the field shows
  the modifiers held and what is missing, and the current shortcut does nothing; keys are read
  from the whole window, since WebKit does not focus a button clicked.
- **Conflicts**: a combination the system turns down keeps the previous one, and the field says
  why. Windows and X11 refuse one another app holds. macOS does not: registrations are not
  exclusive, and no API lists other apps' hot keys. Nor does it report its own shortcuts, which
  Sidekyk reads (`CopySymbolicHotKeys`) to warn; while they are on, their keys never reach the
  field. A stored shortcut refused at startup, or that macOS uses too, is a problem in the top
  bar, fixed in the settings. Conflicts inside another app (`⌥Space` typing a non-breaking space)
  cannot be seen.
- **`⌥`-only shortcuts work on macOS**: reports from macOS 15's betas said `RegisterEventHotKey`
  refuses shortcuts whose only modifiers are `⌥`/`⌥⇧`. Tried on macOS 27.0.1 on 2026-10-15: they
  register and are delivered (`⌥Space`), as is a function key alone (`F5`), so Sidekyk refuses
  neither.
- **Cost**: nothing while idle; one registration at startup and at each change. +160 KiB on the
  macOS release binary.

## What changes in the rules

When these land, `AGENTS.md` changes too:

- The read-only invariant becomes explicit about its scope: repositories are never written; app
  data (projects, notes) is.
- Sync is the app's first network access: say where it lives (backend only) and what it may reach.

## Open decisions

- Notes: format and granularity (one file per note is the natural unit, see Notes).
- Sync: `drive.appdata` (hidden backup) or `drive.file` (files visible in Drive).
- Sync: conflict strategy, and whether to encrypt notes before upload.
- Explorer: `git grep` or ripgrep's crates for the search in contents.
- Quick capture of a note through a global shortcut.
- Global shortcut: its default combination (`⌃⌥Space`, `Ctrl+Alt+Space` for now, in
  `DEFAULT_GLOBAL_SHORTCUT`). `⌃⌥Space` is free on a Mac with one input source; with two, macOS's
  "next input source" uses it, which Sidekyk warns about. `⌥Space` is Raycast's and Alfred's
  default.
- Free canvas: revisit after semantic zoom has been used for a while.

## Sources

- [Choose Google Drive API scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)
- [Store application-specific data (appDataFolder)](https://developers.google.com/workspace/drive/api/guides/appdata)
- [OAuth 2.0 for iOS & desktop apps](https://developers.google.com/identity/protocols/oauth2/native-app)
- [Using OAuth 2.0 to access Google APIs: refresh token expiration](https://developers.google.com/identity/protocols/oauth2)
