# Note references

Files of the project and web addresses in a note's text, recognized as it is typed; `@` suggests
the files. Notes: `notes.md`. Left (a capture's markers, `#list`, commit
hashes): `../../ROADMAP.md`, Notes.

## Behaviour

- Recognized from the text alone, offline: the same text gives the same references. They stay in
  the text, the `@` too, which is what a copy gives an agent or a colleague.
  - A file after `@`: any path of the project, as agents write it (`@Makefile`,
    `@src/app/shell.tsx`).
  - A file without `@`, as an agent's output prints it: only with a folder and an extension
    (`src/app/shell.tsx:42`), so that `and/or`, `v1.2` or `12/05/2026` are not.
  - Lines: `:42`, `:42-50`, `:42:7` (a column: its line), GitHub's `#L42-L50`.
  - `\` read as `/`, a leading `./` dropped. Never a path outside the project: absolute, from `~`,
    through `..`, on a drive; nor a colon past the lines (`git@github.com:org/repo.git`) or a part
    ending with a dot (`e.g./i.e.`). Still taken, as they read like paths: `@john` (after `@` any
    name is a file) and `example.com/index.html`; a click says the file is not found.
  - Addresses: `http://` and `https://`. Brackets, quotes and punctuation around a reference are
    left out; a parenthesis the address opened is kept (`…/A_(b)`).
- Files only in the notes of the project on screen, while its folder's Files panel shows (not in
  the Inbox, nor while its WSL distro is stopped); addresses in every note.
- A card shows them in the accent's color, underlined under the pointer, the tooltip saying where
  each leads. A click opens it; a click elsewhere edits the note. While editing they are tinted;
  `⌘`-click (Ctrl elsewhere) opens one, `⌥↵` (Alt+Enter) the one at the caret, from the keyboard
  (in the Shortcuts help).
- `@` and a letter list the folder's files ranked as the palette ranks them, at most 8, under the
  `@` (above it where there is no room): the name, its folder muted, the letters typed in bold.
  `↑`/`↓` move, `↵` or `Tab` put `@path ` in place of what was typed, a click picks, `Esc` closes
  the list and leaves the note open; with a modifier (`⌘↵`) the keys are the note's. Typing in
  the reference opens the list again. A line is typed after the path (`:42`), which ends the
  list. Not offered: a file deleted (Changes still lists it) and a path with a space, which would
  end the reference there.
- A file opens in Files full screen, three lines above its lines, which are marked (an accent bar
  and tint) until another file is picked, also after leaving Files and coming back; a changed
  file shows whole with its changes. A Markdown or SVG file in its preview opens at the lines,
  unmarked (the marks are the code's). `Esc` goes back. Lines past the file's end: an unchanged
  file opens at its top, a changed one at its first change.
- A project of several folders: the folder on screen first. A file only another folder has opens
  there, that folder coming on screen; several ask which, the folder dialog offering only those.
- A file moved, renamed or deleted since the note was written: a toast "File not found: path",
  nothing else. The note keeps its text.

## How it is built

- `notes/model/entities.ts`: `noteEntities` (the references and their offsets), `entityParts`
  (the text cut at them, for the card and the tint), `typingAt` (the `@` being typed at the
  caret), `withSuggestion` (the text with a file picked); unit tested.
- What references reach comes from the app through `NoteReferences` (`app/note-references.ts`),
  as `MoveTargets`: notes import neither search nor repository. `filesOf(book)` is the folder on
  screen's files for its project's notes, null for any other book.
- `search_files(folderId, query)`: the palette's ranking of the folder's files
  (`search::search_files`), the best 20; nothing for an empty query, nor while the distro is
  stopped. Asked at each key while a list shows (`['note-files', folder, query]`, the previous
  list kept while the next comes, nothing cached once closed).
- `folders_holding(projectId, first, path)` (`ProjectsState::folders_holding`), only on a click:
  `first`, the folder on screen, alone when its tree holds the path (`file_stamp`, its cached
  tree, which its watcher keeps fresh); else the other folders side by side (scoped threads),
  their trees read again and not kept (`tree_holds_now`, also through the WSL helper): no watcher
  keeps theirs fresh, and an agent may have just written the file. A path moved, deleted, ignored
  or through `..` is in none; a folder readable only by starting its distro is left out. An
  answer that comes after another project or folder came on screen is let go; any failure is a
  toast (`common.openFailed`), never thrown.
- Files: `fileTarget(path, hunk, find, lines)`. The lines go into the selection, its one owner
  (`Selection.lines`), dropped by any other file picked: they stay marked across a remount, and the
  viewer opens on them as it mounts, and again at each request (a count keys it). `Pane` turns them
  into rows (`rowsOfLines`), `DiffList` marks them. The request goes with the zoom to Files full
  screen and is taken once (`../architecture.md`, Panel requests).
- `ReferenceLayer`: the field's text again over it, transparent, `pointer-events: none`, with the
  field's font, padding and wrapping (`getComputedStyle`), its box (`ResizeObserver`) and its
  scroll; entities as `<mark>` tinted. An empty span at the `@` anchors `FileMenu`, a portal: a
  card's list would cut it. The field keeps the focus (`aria-activedescendant`).
- A card's text (`NoteText`): spans with `data-entity` inside its button, which tells a click on one.
- `highlightParts` and `MatchedText` (`shared/`): the palette's and the list's letters in bold.

## Decisions

- References stay in the text, `@` included: a note pasted into an agent's prompt
  names the files as the agent reads them.
- A file gone is not shown dimmed: that would check every reference of every card
  shown, again at every change. It is checked on a click; the maintainer asked for no tracking
  of moves, only no failure.
- Files full screen, not Changes: the lines a note names are the file's as it is now,
  and a diff hides most of it.
- Suggestions from the folder on screen, its paths relative to it: what the agent
  working there reads.
- No way yet to say "not a reference": a tint does nothing until clicked; decided once tried.
