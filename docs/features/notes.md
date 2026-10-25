# Notes

Cards in lists, per project and in the Inbox, stored in the app's data (built 2026-10-17). Sync:
`../../.cflow/plans/notes-sync.md`.

## Behaviour

- Cards, not documents: plain text, the user's order (new on top), marked done when used; done
  cards fold into "Done (n)". Actions on the card, never in its text: done circle left, copy and ⋯
  right (move to top, reorder, Move…, delete; move and delete undoable).
- Edit in place: four lines shown, all when clicked; `Esc`, `⌘↵` or a click outside closes; an
  empty card goes (Undo). Long lines wrap or scroll (setting `noteLines`, `⌥Z` in a note).
- The field on top adds to the open list: `↵` adds, `⇧↵` a new line, a paste into the empty field
  adds at once; `⌘N` focuses it.
- Lists by topic: on the left full screen, a menu from the header in a tile. Double click renames;
  a list's ⋯: Rename, Move to project…, Delete (with its notes, Undo; the last list only renames).
  A project opens on the list last open.
- Order without drag and drop: "Move to top", and "Reorder…" (a row per card with ↑, position, ↓;
  a typed position for long jumps; `⌥↑`/`⌥↓`). Done cards stay by when done.
- Export a project's notes to Markdown from the panel's ⋯, never inside a repository. Removing a
  project with notes asks: export then remove, or delete; nothing stays on disk.
- Inbox (2026-10-23): whatever comes to mind, to sort later; a column at level 0 left of the
  cards. Not a project: no card, level 1, folder, removal or rename. The field on top (`⌘N` at
  level 0), newest first. Its notes are edited, copied, moved or deleted; no lists, done or order.
- Move (2026-10-23): one dialog from a note's ⋯ (Move…) and a list's ⋯ (Move to project…). A note
  goes between the Inbox and projects, or to another list; a list to another project, whole, into
  its list of the same name if any. Suggestions are the books ranked as the palette ranks names (a
  name two books share shows its folder); `Tab` makes the one chosen a chip, whose lists come
  next; Backspace on the empty field removes it; `↵` moves, with a project's chip and nothing
  chosen into the list it opens on. Text that is not exactly a name gets a last row, never hidden:
  "New project “…”" (without folder) or "New list “…”". A note's own project starts as the chip.
  After a move a toast with Undo, which puts the note or list back where it was; a project made
  for the move stays.
- Found by `⌘K`, at level 0 across every book (`search.md`).

## How it is built

- Books (2026-10-23): the notes of a project or of the Inbox. On the wire a string, the project's
  id or `inbox` (`INBOX_BOOK`, never a project id), made a `Book` (`Inbox | Project { id, name }`)
  in the interface. The Inbox has one list, never shown; the store refuses on it what only
  projects have (lists, done, order): programming errors, not user-facing codes.
- Storage: `<app data>/notes/<name>-<6 hex>/` per project (named when first written) and
  `notes/inbox/`, never in repositories: `project.json` (the project's id), `lists.json` (order),
  `state.json` (open list, this machine only), one `<id>.json` per note (text, list, position,
  edited, done). A move takes the middle of its neighbours' positions, renumbering only when no
  room is left. Ids are 16 hex digits, the only names let through to files.
- Every book read stays in memory (`NotesStore::books`, one lock) until quit or removal: the cards
  read every book at start, so files are read once per session. A change writes at once only the
  files it touched (written beside, `sync_all`, renamed over); a failed write drops that book,
  read again at the next call. Safe because only the app writes there (single instance, every
  change through the store); a sync must write through it too. Until its first change a book's
  first list has a fixed id, so the frontend's survives a failed write.
- Moving (`move_note`, `move_list`): a note keeps its id and goes on top of the target's open
  notes (`ListTarget`: the open list, a list, a new one); done stays done, except into the Inbox.
  The book that takes is written first (`NotesStore::exchange`), so a failure leaves the notes in
  both, never in neither. `unmove_note` and `unmove_list` undo. A move to a new project
  (`BookTarget::NewProject`) makes it in the interface and removes it if the move fails.
- Move dialog (`MoveDialog`, lazy, through `MoveHost`): Base UI's Autocomplete; its logic is pure
  functions (`model/move-dialog.ts`, unit tested). The projects and the ranking (`rank_names`)
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
  notes. A card saves 500 ms after typing stops and on close. A book's summary and count are
  cached under its key and made stale by every change.
- Measured (release, ~470-character notes): 1,000 notes read 26 ms, a change 5 ms (mostly
  `sync_all`); every book kept (2026-10-24, 1,000 / 9,000 / 30,000 notes): 0.65 / 6.2 / 18.6 MB,
  the cards at start 23 / 280 / 1,030 ms, a project switch 0.01-0.05 ms (was 2.2-11.3 ms).

## Decisions

- One file per note (2026-10-17): a change writes one file, a sync conflict is one note.
- Removing a project never leaves its notes on disk (2026-10-17).
- Every book kept in memory once read (2026-10-24, the maintainer: memory over disk reads): about
  0.6 MB per 1,000 notes; no eviction and no index until a measure asks.
