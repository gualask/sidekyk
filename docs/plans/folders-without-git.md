# Plan: folders without git

Direction 2026-10-17. A project may be any folder (documents of any kind), for users who are not
developers; git optional.

## Design

- Without git: no Changes, summary counts, recent commits or tray count; Files and Notes are the
  panels.
- Already free of git: the tree (`FileTree` from a path list), the file viewer (`read_entry`), the
  palette's ranking, content search (in-process over a file list), notes. Tied to git: Changes,
  snapshot/summary, commits, tray count, the watcher's filter (`check-ignore`), the file list
  (`git ls-files`), opening a project (`not_a_repository`).
- Rule from now: what does not need git does not use it. The file list sits behind a port
  (`ignore`, ripgrep's walker, the candidate without git).

## Open

- Two templates (developer / everyday) chosen by the user, or panels derived per project
  (git → Changes), the template at most a global preference hiding developer parts (leaning to
  derived).
- Level 0 card without git; watcher filter without git (`.gitignore`/`.ignore` rules).
- Documents (PDF, Office) need text extraction and likely an index (`tantivy`), i.e. work in the
  background against the golden rule: a separate decision, with measures.
