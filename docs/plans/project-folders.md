# Plan: projects with optional folders

A project is its notes and zero or more folders; its panels come from what it has. Direction
2026-10-17 (git optional), model agreed 2026-10-22 (folder optional, Inbox, several folders as VS
Code's multi-root workspaces). High level; details when it is built.

## Use cases (2026-10-22)

- Notes that belong to no project: the Inbox, then moved to a project.
- A topic for a non-developer ("Home", "Thesis"): notes, lists, perhaps a folder to browse.
- An agent at work in a folder without git (a project before `git init`, scripts, output
  folders): which files it touched, read them.
- A folder of documents (Markdown vault, specs, papers): readable Markdown (`previews.md`), search
  in contents, notes beside. A folder of material (images, PDF, exports): see them without
  another app.
- A product in several repositories (api, web, ops): one project, one review of a change across
  them.

## Design

- One container, the project, not lists of global notes beside projects (two navigations, two
  places for a note). Lists stay topics inside a project.
- Panels derived from the project, never templates chosen by the user: no folder, Notes only; a
  folder, Files too; a repository, Changes too (a `git init` later shows it: the watcher sees
  `.git`). Built (no folder and a repository 2026-10-23, a folder without git 2026-10-24,
  `../features/workspace.md`, `../features/files.md`).
- Inbox: not a project, a column at level 0 beside the cards, always there (built 2026-10-23,
  `../features/notes.md`). Every note can be moved to a project and back (the Move dialog, built
  2026-10-23, `../features/notes.md`). Projects without folder
  are made by the user (New project, built 2026-10-23, `../features/projects.md`).
- Notes feel global without being so: the Inbox, moving notes, `⌘K` at level 0 finding notes of
  every project (today only projects).
- Id: made, not derived from a location (built 2026-10-22, `../features/projects.md`); Locate…
  changes a folder, not the project.
- One folder first; several folders (VS Code's multi-root workspace) after, the model shaped for
  them from the start so the stored projects change once.
- Without git (built 2026-10-24: Files and Notes, the walk and its rules behind the port, the
  watcher without a git dir, any folder taken; `../features/files.md`, `../features/projects.md`):
  what changed is next.
  - What changed: no diffs (no base without copying files, as VS Code's local history does only
    for its editor's saves); the tree by date modified, as file managers, and a mark on files
    touched since the project opened (the watcher knows).
  - Level 0 card: today the folder and the notes, as a project without folder; files modified
    per day over the week (from the walk's mtimes; to measure) only if wanted, since it walks
    every folder at level 0.
- Rule: what does not need git does not use it (a folder is taken, its kind read, its files
  walked and watched without git).

## Several folders

- Files: one root per folder; Changes: a section per repository, as VS Code's Source Control
  with several repositories (to check in its docs and Zed's git panel before designing).
- A file is a folder and a path everywhere (selection, tree, search, snapshot, copy): a contract
  change across modules.
- Watched only while on screen, one watcher per folder: cost grows with folders (inotify: a watch
  per folder git does not ignore).
- Card and top bar: counts summed, branches per repository (where: open).
- Folders of one project on one machine (local or one WSL distro), at least at first.

## Open

- What takes Changes' tile without git: Notes (the maintainer's leaning: an overview, notes of
  text and images, `capture.md`), Files beside. Decided together with Capture.
- The name: "project" sounds like a developer's word for a topic or the Inbox ("space"?).
- Where a global capture lands: the Inbox while the window is hidden (2026-10-22); the project on
  screen while shown? To try (`capture.md`).
- Documents (PDF, Office) need text extraction and likely an index (`tantivy`), i.e. work in the
  background against the golden rule: a separate decision, with measures.
