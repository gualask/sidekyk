# Files

The project's tree and the view of any file in it; Recent, its files by last
change.

## Behaviour

- Tree as VS Code's: folders first, compact folders, change colors (amber, green new; a folder takes
  the strongest) with words in the tooltip, never a horizontal scrollbar; collapse-all.
- In a tile the tree alone: a file picked shows in Changes, or without git in Files full screen
  (click, `Space`, `↵`; `j`/`k` move the file `↵` opens); full screen tree and viewer.
- One selection for both panels, as VS Code's explorer follows the editor: Changes
  selects the file in its list, Files reveals it. A commit's file leaves the tree alone.
- File view: files of the tree only, the first 2 MiB, notices for binary, link and submodule,
  links never followed; the same rows and copy as diffs. Markdown, SVG and images show as they
  read too (`previews.md`).
- Recent, with or without git: an icon in the header switches the tree for the files
  by last change on disk, newest first, as VS Code's Source Control switches tree and list; kept
  per project for the session. Headings as a file manager by date modified: Today, Yesterday,
  Previous 7 days, Previous 30 days, Earlier, each with its count. A row: name, its folder muted,
  the time (`14:32` today and yesterday, `Mon 18:05` in the week, then the date, with its year when
  not this one); the whole date and a change's word in the tooltip; a change colors the name as in
  the tree. Keys, picking and the tile as the tree's. Files deleted are not listed.
- A folder without git: no change colors. Hidden: what `.gitignore` and `.ignore`
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
- `get_recent_files`: the tree's files (the cached list) timed by
  `RepositoryBackend::modified_times`: `lstat` in parallel (8 threads, one below 1,024 files), each
  folder on the way checked once against links (a link's own time, never followed), sorted newest
  first, path order within a time; at most 10,000 plus a count. Read only while Recent shows,
  again at any change on disk and when the window shows after one; grouped as of the read, no
  timer. Measured (release, warm cache): Zed's clone 4.2 ms (4,366 files, JSON included);
  200,000 files of `~/Library` 230-250 ms warm, 1.45 s cold, 1.5 MB of JSON; `file_stamp` per file
  on one thread 2.9 s.
- `get_file_content`: files of the tree only. `read_entry` refuses a path through a linked folder,
  gives a link's target unfollowed, a submodule as a folder, a file's first 2 MiB cut at a whole
  line (binary by NUL).
- Shared selection (`model/selection.ts`, one per project): a changed file by key, or a tree path
  shown as a change while it is one.

## Decisions

- Tree from `git ls-files` (`.gitignore` applies); deleted tracked files left out (Changes lists
  them). A read-only tree on the virtualizer, no tree library. The backend keeps the list and serves
  the open folders, so the payload is what is open.
- Without git: `ignore` 0.4 (ripgrep's walker and matcher), chosen by the maintainer
  over `walkdir` plus our own parser, `jwalk`, `gix`'s dirwalk. Found paths go to one list under a
  lock: as fast as per-thread lists merged at the end; a channel to a collector (ripgrep's
  `--files`) 10-25% slower; one thread 3-13x slower.
- A folder without git walked again on a file added or removed, as `ls-files` runs
  again: one path for both kinds, until a measure asks otherwise.
- Recent from the disk's times, not the watcher: only the project on screen is
  watched, and an agent works while the window is hidden or another project shows; the times hold
  whatever writes, across restarts, at no cost in the background. Costs: a file copied or unpacked
  with its old time (`cp -p`, `unzip`) shows as old, a deleted one leaves no trace. Not the tree
  sorted by date modified (VS Code's `explorer.sortOrder: "modified"`): a folder sorts by its own
  time, which changes only when an entry comes or goes, and touched files stay in closed folders.
  Computed whole at each read: a batch patching the times is left until the cost shows (in the
  worst case it is below the walk a folder without git already does again on a file added).
- Hidden rules as Zed (every `.gitignore` it meets); the always-hidden names are the VCS folders
  and OS files of Zed's `file_scan_exclusions`.
