# Files

The project's tree and the view of any file in it (built 2026-10-17).

## Behaviour

- Tree as VS Code's: folders first, compact folders, change colors (amber, green new; a folder
  takes the strongest) with words in the tooltip, never a horizontal scrollbar; collapse-all.
- In a tile the tree alone, Changes being the one viewer (an unchanged file shows as its text);
  full screen, tree + viewer. Tree width as every sidebar's (`workspace.md`); the fit takes the open
  rows.
- One selection for both panels, as VS Code's explorer follows the editor (revised 2026-10-17;
  the mock kept them apart): Changes selects it in its list, Files reveals it (opens the folders
  above). A commit's file leaves the tree alone.
- File view: files of the tree only, first 2 MiB, binary/link/submodule notices, links never
  followed; same rows and copy as diffs.

## How it is built

- List: `git ls-files -z --cached --others --exclude-standard` minus `--deleted` (in parallel),
  at most 200,000 files. `FileTree` (Rust) sorts each folder as VS Code (folders first, case
  ignored, numbers by value) and resolves compact folders; `get_directory` serves one folder from
  memory, at most 10,000 entries plus a count. 48 ms on Zed's clone, a folder 3 µs.
- Only the tree of the project on screen is cached, read on first request. A batch drops it when
  the git dir changed or a non-ignored path appeared/disappeared (`may_have_changed`: `stat`
  against the tree); a marked batch while hidden and a project switch drop it too. A read racing a
  change is not kept.
- `get_file_content` (`ProjectsState::file_content`): only files of the tree. `read_entry` refuses
  a path through a linked folder, returns a link's target unfollowed, a submodule as a folder, a
  file's first 2 MiB (cut at a whole line; binary by NUL).
- Shared selection (`model/selection.ts`, one per project): a changed file by key, or a tree path
  shown as a change while it is one.

## Decisions

- Tree from `git ls-files` (`.gitignore` applies); deleted tracked files left out (Changes lists
  them). Read-only tree on the virtualizer, no tree library.
- The backend keeps the list and serves open folders (2026-10-17), so the payload is what is open.
  Files is the second panel of the repository module (once `changes`), sharing its viewer.
- Without git the file list goes behind a port: `../plans/folders-without-git.md`.
