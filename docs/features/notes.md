# Notes

Cards in lists, per project and in the Inbox, stored in the app's data. Images
in notes: `note-images.md`; files and addresses in their text: `note-references.md`. Sync:
`../../.cflow/plans/notes-sync.md`.

## Behaviour

- Cards, not documents: plain text and images below it (`note-images.md`), the user's order (new
  on top), marked done when used; done cards fold into "Done (n)". Actions on the card, never in
  its text: done circle left; copy and ⋯ at the end of the line with its time, shown under the
  pointer or the focus, so the text takes the card's width (move to top, reorder, Move…, delete;
  move and delete undoable).
- A card is filled (`--ui-surface-raised`, a step off the panel) with a soft shadow, no border;
  under the pointer a step further (`--ui-surface-raised-hover`) and its shadow deeper, since a
  click edits it. Edited, or with an image dragged over it, it has an accent border. The same
  card in a project's Notes and in the Inbox.
- Edit in place: four lines shown, all when clicked; `Esc`, `⌘↵` or a click outside closes; an
  empty card goes (Undo). Long lines wrap or scroll (setting `noteLines`, `⌥Z` in a note).
- The field on top ("Write or paste a note…", the same in the Inbox) adds to the open list: `↵` adds, `⇧↵` a new line, a paste into the empty field
  adds at once; `⌘N` focuses it.
- Lists by topic: on the left full screen, a menu from the header in a tile. Double click renames;
  a list's ⋯: Rename, Move to project…, Delete (with its notes, Undo; the last list only renames).
  A project opens on the list last open.
- Order without drag and drop: "Move to top", and "Reorder…" (a row per card with ↑, position, ↓;
  a typed position for long jumps; `⌥↑`/`⌥↓`). Done cards stay by when done.
- Export a project's notes to Markdown from the panel's ⋯, never inside a repository. Removing a
  project with notes asks: export then remove, or delete; nothing stays on disk.
- Inbox: whatever comes to mind, to sort later; a column at level 0 left of the
  projects. Not a project: no row, level 1, folder, removal or rename. The field on top
  (`⌘N` at level 0), newest first. Its notes are edited, copied, moved or deleted; no lists, done
  or order.
  From any app: the quick note (`quick-note.md`).
- Move: one dialog from a note's ⋯ (Move…) and a list's ⋯ (Move to project…). A note
  goes between the Inbox and projects, or to another list; a list to another project, whole, into
  its list of the same name if any. Suggestions are the books ranked as the palette ranks names (a
  name two books share shows its folder); `Tab` makes the one chosen a chip, whose lists come
  next; `↵` moves, with a project's chip and nothing chosen into the list it opens on; `Tab` on
  a list makes it a second chip; Backspace on the empty field takes the last chip away; typing
  over the Inbox's chip or a list's chooses again. Among a project's lists, text that is not
  exactly a name gets a last row, never hidden: "New list “…”". No new project: a project is made
  from its own flow. A note's own project starts as the chip. The quick note chooses its place
  with the same field (`quick-note.md`). After a move a toast with Undo, which puts the note or
  list back where it was.
- A project merged into another brings its lists of notes (`project-folders.md`).
- Found by `⌘K`, at level 0 across every book (`search.md`).

## How it is built

- Books: the notes of a project or of the Inbox. On the wire a string, the project's
  id or `inbox` (`INBOX_BOOK`, never a project id), made a `Book` (`Inbox | Project { id, name }`)
  in the interface. The Inbox has one list, never shown; the store refuses on it what only
  projects have (lists, done, order): programming errors, not user-facing codes.
- Storage: `<app data>/notes/<name>-<6 hex>/` per project (named when first written) and
  `notes/inbox/`, never in repositories: `project.json` (the project's id), `lists.json` (order),
  `state.json` (open list, this machine only), one `<id>.json` per note (text, list, position,
  edited, done, images), and its images' files. A move takes the middle of its neighbours'
  positions, renumbering only when no room is left. Ids are 16 hex digits, the only names let
  through to files.
- Each file says its form's `version` (`STORED_VERSION`): a change older versions would not keep
  whole (a field added: they write the note again without it) raises it. A book with a note or
  `lists.json` that does not read, or of a newer version, is refused (`notes_unreadable`, shown
  where its notes go): never written, not read again that session. A `state.json` that does not
  read opens the first list; a `project.json` that does not read leaves its folder to no project,
  untouched.
- Every book read stays in memory (`NotesStore::books`, one lock) until quit or removal: a book is
  read the first time it is asked for (its project's Notes; the palette at all projects reads them
  all), so files are read once per session. A change writes at once only the
  files it touched, whole (`write_whole`, `../architecture.md`); a failed write drops that book,
  read again at the next call. Safe because only the app writes there (single instance, every
  change through the store); a sync must write through it too. Until its first change a book's
  first list has a fixed id, so the frontend's survives a failed write.
- Moving (`move_note`, `move_list`): a note keeps its id and goes on top of the target's open
  notes (`ListTarget`: the open list, a list, a new one); done stays done, except into the Inbox.
  The book that takes is written first (`NotesStore::exchange`), so a failure leaves the notes in
  both, never in neither. `unmove_note` and `unmove_list` undo. The book moved to is a key, as
  every command's.
- Move dialog (`MoveDialog`, lazy, through `MoveHost`): the destination field (`DestinationField`
  on Base UI's Autocomplete, `useDestination`), shared with the quick note; its logic is pure
  functions (`model/destination.ts`, unit tested). The projects and the ranking (`rank_names`)
  come from the app through `MoveTargets`, so notes import neither projects nor search.
- Limits and failures: a note at most 1 MiB (`note_too_long`); `note_missing`, `note_list_missing`;
  a broken file is skipped and logged, never removed; a change that changes nothing writes
  nothing. A new folder never takes one in use (two projects of one name).
- Export (`export_notes`): a section per list, notes between `---`, done ones under `### Done`;
  refused inside a project's repository (`export_in_repository`, `ProjectList::holds`). Removing a
  project deletes its notes first; if they cannot go, the project stays (`RemoveProjectDialog`).
- Frontend: `NotesWorkspace` (lazy), cards virtualized with measured heights (`useCardRows`);
  `InboxColumn` (the app places it at level 0) with the same `Composer` and `NoteCard`.
  `useNotes` reads a book once (`['notes', book]`, never stale: only the app writes);
  `useNoteActions` changes the cache at once, then sends the change after those before it
  (`ChangeQueue`, per book); only the last answer is shown, a skipped or failed one rereads the
  notes. A card saves 500 ms after typing stops and on close. A book's count (`count_notes`:
  open and done) is asked by a project's row, its open notes shown from the last count while read
  again, and before a removal, never from an earlier count.
- Measured (release, ~470-character notes): 1,000 notes read 26 ms, a change 5 ms (mostly
  `sync_all`); every book kept (2026-10-24, 1,000 / 9,000 / 30,000 notes): 0.65 / 6.2 / 18.6 MB,
  every book read (once a session: the palette's first search at all projects) 23 / 280 /
  1,030 ms, a project switch 0.01-0.05 ms (2.2-11.3 ms reading the book from disk).

## Decisions

- One file per note: a change writes one file, a sync conflict is one note.
- Removing a project never leaves its notes on disk.
- Every book kept in memory once read (the maintainer: memory over disk reads): about
  0.6 MB per 1,000 notes; no eviction and no index until a measure asks.
- No project made from notes (the maintainer): a project is made on purpose, from its own
  flow; a typo never makes one, nor a failed move leaves one to remove. A new list is made: it is
  inside a project that exists.
