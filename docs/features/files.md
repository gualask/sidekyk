# Files

The project's tree and the view of any file in it (built 2026-10-17).

## Behaviour

- Tree as VS Code's: folders first, compact folders, change colors (amber, green new; a folder
  takes the strongest) with words in the tooltip, never a horizontal scrollbar; collapse-all.
- In a repository's tile the tree alone, Changes being the one viewer (an unchanged file shows as
  its text); full screen, and in a folder without git (no Changes), tree + viewer. Tree width as
  every sidebar's (`workspace.md`); the fit takes the open rows.
- A folder without git (built 2026-10-24): the same tree and viewer, no change colors. Hidden:
  what `.gitignore` and `.ignore` files say (each for its folder and below, `.ignore` first), git's
  global excludes, and always VCS folders (`.git`, `.hg`, `.svn`, `.jj`, `.sl`, `.repo`, `CVS`) and
  OS files (`.DS_Store`, `Thumbs.db`). Dot files show. `.ignore` counts only without git: after a
  `git init` the tree is git's, and what only `.ignore` hid shows. A tracked file an ignore rule
  matches is in git's tree but not in the walk's (it cannot know it is tracked).
- One selection for both panels, as VS Code's explorer follows the editor (revised 2026-10-17;
  the mock kept them apart): Changes selects it in its list, Files reveals it (opens the folders
  above). A commit's file leaves the tree alone.
- File view: files of the tree only, first 2 MiB, binary/link/submodule notices, links never
  followed; same rows and copy as diffs.

## How it is built

- List: `git ls-files -z --cached --others --exclude-standard` minus `--deleted` (in parallel),
  at most 200,000 files. Without git, `RepositoryBackend::walk` (`infrastructure/folder_walk.rs`,
  `ignore`'s parallel `WalkBuilder`, 8 threads at most): stops at 200,000, so past it which files
  are kept may differ from one walk to the next; links listed, not followed. The kind is read for
  each tree read (`folder::folder_kind`, a `.git` at the root). `FileTree` (Rust) sorts each folder as VS Code (folders first, case
  ignored, numbers by value) and resolves compact folders; `get_directory` serves one folder from
  memory, at most 10,000 entries plus a count. 48 ms on Zed's clone, a folder 3 µs; the walk of the
  same clone 14 ms (4,365 files), of Sidekyk's 3.6 ms against `ls-files`' 15 ms, 200,000 files of
  `~/Library` 261 ms (2026-10-24, release, warm cache).
- Only the tree of the project on screen is cached, read on first request. A batch drops it when
  the git dir changed or a non-ignored path appeared/disappeared (`may_have_changed`: `stat`
  against the tree); a marked batch while hidden and a project switch drop it too. A read racing a
  change is not kept. Without git the same: a walk again, not a tree kept from batches.
- `get_file_content` (`Repositories::file_content`): only files of the tree. `read_entry` refuses
  a path through a linked folder, returns a link's target unfollowed, a submodule as a folder, a
  file's first 2 MiB (cut at a whole line; binary by NUL).
- Shared selection (`model/selection.ts`, one per project): a changed file by key, or a tree path
  shown as a change while it is one.

## Decisions

- Tree from `git ls-files` (`.gitignore` applies); deleted tracked files left out (Changes lists
  them). Read-only tree on the virtualizer, no tree library.
- The backend keeps the list and serves open folders (2026-10-17), so the payload is what is open.
  Files is the second panel of the repository module (once `changes`), sharing its viewer.
- Without git the file list is behind the port (`walk`, 2026-10-24): `ignore` 0.4, ripgrep's
  walker and matcher, chosen over `walkdir` plus our own parser, `jwalk`, `gix`'s dirwalk. The
  paths found go to one shared list under a lock: as fast as per-thread lists merged at the end,
  a channel to a collector (ripgrep's `--files`) 10-25% slower, one thread 3-13x slower (measured
  2026-10-24).
- Tree of a folder without git walked again on a file added or removed, as `ls-files` runs again,
  not kept from the watcher's batches: one path for both kinds, until a measure asks otherwise.
