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
| 0, all projects | One card per project: changes in progress, last activity, a glimpse of the notes. It doubles as the project switcher |
| 1, a project | Its panels (Changes, Files, Notes, …) as tiles or tabs |
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

A clickable mock of the three levels was approved on 2026-10-11. It is a single HTML file kept
locally in `.local/mocks/workspace.html` (not versioned). What it settles:

- **Where you are**: the breadcrumb (All projects / project / panel) is enough; no separate
  zoom-level indicator.
- **Project rail** on the left of a project: the "all projects" button first, then one avatar per
  project with its change count, so switching does not need a trip to level 0.
- **Level 0 cards**: branch, changed files with line counts, recent activity, the first note.
- **Keyboard**: `↵` zooms in and `Esc` zooms out; `Esc` is progressive (it first leaves a field or
  clears a filter, then zooms out); `1`/`2`/`3` open Changes, Files, Notes; `[`/`]` switch
  project; `⌘`+scroll and trackpad pinch zoom on the element under the pointer.
- **Command palette** (`⌘K`): projects, panels, files of every project, notes.
- **Notes** have "Copy for agent", like hunks.
- **Still open**: tiles or tabs at level 1 (the mock has both, `T` switches).
- **Not taken**: the mock names the agent at work ("Claude Code · 40s ago"). Sidekyk sees file
  changes, not who made them, and naming the agent is not wanted: cards show when files last
  changed.

## Follow the terminal

The usual flow: in each terminal tab, `cd` into a repository and start the agent there (`claude`).
Sidekyk is brought up from anywhere (global shortcut, launcher, Dock). With this feature on, it
opens on the project of the terminal tab used just before, so moving to another tab and bringing
Sidekyk up again shows the other project. No manual linking: the link is the directory the agent
was started in.

- **Which terminal**: Sidekyk remembers the last app that was frontmost before it. macOS reports
  every app activation without any permission. Remembering it, instead of looking at the frontmost
  app when Sidekyk appears, makes the launcher and the Dock work like the shortcut.
- **Which tab**: Sidekyk asks that terminal for its active tab and the directory of its foreground
  process, then resolves the git root and opens that project (adding it if new).
- **Terminals**: one adapter each, since there is no generic way to know a terminal's active tab.
  kitty first, through its remote control (`kitty @ ls`, which needs remote control turned on in
  `kitty.conf`; socket-only, and used only to read). iTerm2, WezTerm and Terminal.app when needed
  (AppleScript or their CLI; macOS asks once for automation permission).
- **Opt-in, off by default**, in the settings. It depends on each terminal's API and
  configuration, so it must never get in the way: if anything fails (unknown terminal, remote
  control off, a tab outside any repository, the last app was not a terminal), Sidekyk silently
  stays on the project it showed.
- **Cost**: one call when Sidekyk is brought up, nothing while idle.
- **To check when implementing**: whether `kitty @ ls` on kitty 0.49 marks the focused tab and
  window, and how the socket is named when several kitty instances run.
- **Rejected**: picking a window with a click, as macOS's screenshot tool does. It selects a
  window, not a tab (two tabs of one kitty window are one window), and reading other apps' window
  titles needs the screen recording permission.

## Ideas from tazly

tazly (`../tazly`, a Chrome new-tab board of projects, tasks and notes) tried a similar workspace.
Worth taking:

- the focus mode with a sidebar of the other projects (now the project rail);
- a single command bar as the entry point for everything (now `⌘K`);
- "`Esc` cancels, it does not navigate" (now the progressive `Esc`);
- per-project notes with "copy all" (now "Copy for agent");
- **quick capture**: a global shortcut that adds a note to the active project without opening the
  window, as tazly's page widget did. To evaluate with the notes;
- a `PRODUCT.md` with users, purpose and design principles, as tazly has;
- `⌥` shortcuts matched on `e.code`, since on macOS `⌥`+letter types a special character in
  `e.key`.

Not to take: the visionOS-like glass (layered blur costs GPU, against the golden rule), and
Lexical as the notes editor without weighing it first (a heavy dependency; plain Markdown may be
enough).

## Panels

- One module per panel under `src/modules/` (as `changes` is today), exposing a common contract:
  id, title, icon, component, and a summary for level 0. `app` composes them; modules still never
  import each other, and `pnpm boundaries:check` keeps enforcing it.
- A panel that is not on screen does no work: its queries are disabled (`enabled`) and its code
  is loaded lazily, one chunk per panel module.

## Projects

- The list of projects is app data, kept with the settings (see Notes for the location). It
  replaces the single "last repository" setting.
- Only the active project runs full snapshots. Inactive projects keep a light watcher that only
  marks "something changed" without running git (FSEvents on macOS costs close to nothing); level 0
  shows the mark, and the snapshot runs when the project is opened.
- Query caches of inactive projects expire (`gcTime`), so memory does not grow with the number of
  projects.

## Explorer

- **Tree**: `git ls-files` plus untracked files (`--others --exclude-standard`), so `.gitignore`
  applies and large repositories list in milliseconds. The tree is virtualized.
- **File view**: read through the backend with a size limit, rendered with the virtualized rows of
  the diff view. Syntax highlighting comes with the item already on the roadmap (loaded lazily).
- **Search by name**: fuzzy matching over the path list, in the frontend or with a backend crate.
- **Search in contents**: in the backend, with `git grep` or ripgrep's crates, streaming results
  and cancellable when the query changes.
- Each library is chosen at implementation time with pros and cons, per the dependency rule in
  `AGENTS.md`.

## Notes

- **Kept at application level**, never inside repositories: in the app data directory, where
  `settings.json` already lives (`~/Library/Application Support/io.github.gualask.sidekyk` on
  macOS; Tauri's `app_data_dir`).
- **Decided at implementation time**: the format (JSON, Markdown files, a small database) and
  whether notes are one file or one per note or per project. One file per note makes sync
  conflicts smaller; take it into account.

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
- **Where tokens live**: in the OS credential store (Keychain on macOS), never in the webview or
  in a plain file.

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

## What changes in the rules

When these land, `AGENTS.md` changes too:

- The read-only invariant becomes explicit about its scope: repositories are never written; app
  data (projects, notes) is.
- Sync is the app's first network access: say where it lives (backend only) and what it may reach.

## Open decisions

- Notes: format and granularity (one file, one per note, one per project).
- Sync: `drive.appdata` (hidden backup) or `drive.file` (files visible in Drive).
- Sync: conflict strategy, and whether to encrypt notes before upload.
- Explorer: fuzzy matching in the frontend or the backend; `git grep` or ripgrep's crates.
- Level 1 layout: tiles or tabs.
- Quick capture of a note through a global shortcut.
- Free canvas: revisit after semantic zoom has been used for a while.

## Sources

- [Choose Google Drive API scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)
- [Store application-specific data (appDataFolder)](https://developers.google.com/workspace/drive/api/guides/appdata)
- [OAuth 2.0 for iOS & desktop apps](https://developers.google.com/identity/protocols/oauth2/native-app)
- [Using OAuth 2.0 to access Google APIs: refresh token expiration](https://developers.google.com/identity/protocols/oauth2)
