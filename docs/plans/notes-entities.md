# Plan: entities in notes

Parts of a note recognized while typing, as OpenTodo's quick add (`../product.md`). High level,
agreed 2026-10-22; the interaction is settled after a first version has been tried.

## Design

- Entities stay in the text: a note's text is what is copied to an agent or a colleague (OpenTodo
  takes them out into task fields).
- Tinted in the text, from a layer behind the field (same font and padding), so the field stays
  plain text (rich-text editors not taken, `../product.md`); a click on an entity opens it.
- Recognized in the app, offline, deterministic: same text, same entities.
- Entities, most useful first:
  1. A file of the project, `src/app/shell.tsx:42`, with completion after `@` as agents do;
     opens the file in the viewer at the line. Works without git.
  2. Markers of a capture (`A`, `B`) in a note with its image: point at the marker
     (`capture.md`).
  3. `#list` when adding a note: added to that list (the one entity that may leave the text).
  4. Links (in the browser) and, with git, a commit hash (opens the commit).
- Not taken: dates and reminders (a task manager; a reminder needs a timer while idle).

## Open

- The interaction (chips under the field or not, saying "no" to an entity: OpenTodo's ×,
  Backspace at the end, quotes): decided after trying it.
