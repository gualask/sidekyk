# Files

The project's tree and the view of any file in it (built 2026-10-17).

## Behaviour

- Tree as VS Code's: folders first, compact folders, change colors (amber, green new; a folder takes
  the strongest) with words in the tooltip, never a horizontal scrollbar; collapse-all.
- In a repository's tile the tree alone, Changes being the viewer; full screen, and in a folder
  without git, tree and viewer.
- One selection for both panels, as VS Code's explorer follows the editor (2026-10-17): Changes
  selects the file in its list, Files reveals it. A commit's file leaves the tree alone.
- File view: files of the tree only, the first 2 MiB, notices for binary, link and submodule,
  links never followed; the same rows and copy as diffs. Markdown, SVG and images show as they
  read too (`previews.md`).
- A folder without git (2026-10-24): no change colors. Hidden: what `.gitignore` and `.ignore`
  files say (each for its folder and below, `.ignore` first), git's global excludes, and always
  VCS folders (`.git`, `.hg`, `.svn`, `.jj`, `.sl`, `.repo`, `CVS`) and OS files (`.DS_Store`,
  `Thumbs.db`). Dot files show. After a `git init` the tree is git's, so what only `.ignore` hid
  shows, and a tracked file an ignore rule matches is in git's tree but not in the walk's.

## How it is built

- List: `git ls-files -z --cached --others --exclude-standard` minus `--deleted`, in parallel. Without
  git, `RepositoryBackend::walk` (`infrastructure/folder_walk.rs`, `ignore`'s parallel `WalkBuilder`,
  8 threads at most), links listed, not followed. At most 200,000 files; past that a walk may keep
  different files each time. The kind is read at each tree read.
- `FileTree` (Rust) sorts as VS Code (folders first, case ignored, numbers by value) and resolves
  compact folders; `get_directory` serves one folder from memory, at most 10,000 entries plus a
  count. Measured (release, warm cache): Zed's clone 48 ms with git, walked 14 ms (4,365 files); a
  folder 3 µs; Sidekyk walked 3.6 ms against `ls-files`' 15 ms; 200,000 files of `~/Library`
  261 ms.
- Only the tree of the project on screen is cached, read on first request, never at level 0. A
  batch drops it when the git dir changed or a path not ignored appeared or disappeared
  (`may_have_changed`: `stat` against the tree); a batch marked while hidden and a project switch
  too. A read racing a change is not kept. Without git the same: walked again, not patched from
  batches.
- `get_file_content`: files of the tree only. `read_entry` refuses a path through a linked folder,
  gives a link's target unfollowed, a submodule as a folder, a file's first 2 MiB cut at a whole
  line (binary by NUL).
- Shared selection (`model/selection.ts`, one per project): a changed file by key, or a tree path
  shown as a change while it is one.

## Decisions

- Tree from `git ls-files` (`.gitignore` applies); deleted tracked files left out (Changes lists
  them). A read-only tree on the virtualizer, no tree library. The backend keeps the list and serves
  the open folders (2026-10-17), so the payload is what is open.
- Without git (2026-10-24): `ignore` 0.4 (ripgrep's walker and matcher), chosen by the maintainer
  over `walkdir` plus our own parser, `jwalk`, `gix`'s dirwalk. Found paths go to one list under a
  lock: as fast as per-thread lists merged at the end; a channel to a collector (ripgrep's
  `--files`) 10-25% slower; one thread 3-13x slower.
- A folder without git walked again on a file added or removed (2026-10-24), as `ls-files` runs
  again: one path for both kinds, until a measure asks otherwise.
- Hidden rules as Zed (every `.gitignore` it meets); the always-hidden names are the VCS folders
  and OS files of Zed's `file_scan_exclusions`.
