# Quick note

A note written from any app, for the Inbox unless another place is chosen: a global shortcut
shrinks Sidekyk's window to a field, `↵` adds the note and the window goes back as it was (macOS;
Windows and Linux in `../../ROADMAP.md`). The Inbox
and the Move dialog: `notes.md`.

## Behaviour

- Entries: the global shortcut "Write a quick note for the Inbox" (Settings, default `⌃⌥N`,
  provisional; `background.md`) and the tray's New Note. Pressed again while the note is open,
  it closes it as `Esc`.
- The window becomes the note: 560x168 pt, centered on the display under the pointer, a quarter
  down, without its traffic lights. The field fills it (15 px); below it, on the left, where the
  note goes, and the keys on the right (`↵` add, `⇧↵` new line, `Tab` where, `Esc` close). The
  field keeps its height and scrolls. In a window that cannot shrink (native full screen) the
  note is a 560 pt box in the middle of the app's background, in Sidekyk's Space.
- Where it goes: the Move dialog's field (`notes.md`, Move), its chips starting as "Inbox". `Tab`
  goes there (`⇧Tab` back); Backspace takes the last chip away, typing over "Inbox" or a list
  chooses again, the suggestions open above it. A project becomes a chip, then one of its lists;
  a project left without a list gets the one it opens on as its chip. A new list is offered as in
  Move; no new project (`notes.md`, Decisions). `Esc` there puts the destination back as it was
  and returns to the note.
- In the destination `↵` on a suggestion chosen makes it a chip, as `Tab` (the maintainer:
  a choice is a choice, not the note sent); without one it adds the note, or with no
  note written returns to it. `↵` in the note adds it and closes. A paste into the empty field
  adds at once and closes, as the Inbox's field does; images pasted or dropped after text wait
  below it as chips until `↵`. `⌥Z` switches long lines as in any note field.
- The next note starts for the Inbox again. `Esc`, a click outside or the shortcut again close
  without adding; what was typed and where it goes come back at the next note, for the session.
  Closing ends a choice in progress, as leaving the field does (a field hidden with the focus
  may never say it lost it).
- Then the window goes back as it was: in front stays in front; on screen behind another app
  stays behind, and the app that was in front gets the focus back; hidden or minimized goes
  hidden (a minimized window is no longer in the Dock after a note).
- Any other way of showing the window (its shortcut, the tray's Show, the Dock, a capture's marks)
  closes the note and leaves the layout in front. Closing the window (`⌘W`) closes the note.
- The layout under the note keeps its state (level, project, scroll) and none of its keys act
  while the note shows.

## How it is built

- One window, one WebView: the main window's own page switches between the note and the layout,
  kept mounted and hidden (`QuickNoteHost`, `notes/ui/QuickNote.tsx`). The note shares the Inbox
  field's logic (`useNoteDraft`) and drops (`useColumnImages`), and Move's destination field
  (`DestinationField`, `useDestination`, `model/destination.ts`: subject `new`, `settled` when
  the field is left).
- A note goes into the Inbox, then where its chips say through the Inbox's `moveNote` with the
  `Move` they make (`moveOf`): a list to make, the images and the toast with Undo are Move's,
  the toast saying "Added to …". Undo and a failed move leave the note in the Inbox.
- A hidden webview never paints, and a window shown before its page painted shows the frame
  before it. So the backend (`interfaces/tauri/quick_note.rs`) turns the window transparent
  (`NSWindow.alphaValue` 0), changes its frame and shows it, then tells the page (`quick-note`:
  `open`); the page, two animation frames later, says it painted (`quick_note_shown`) and the
  window turns opaque. Closing is the same the other way (`close_quick_note`, `close`,
  `quick_note_restored`); a layout put back while the window is hidden paints and turns opaque
  at its next show.
- Before the note: shown, focused, frame, the app in front (`NSWorkspace.frontmostApplication`);
  where the window goes back is a pure function of them (`back_to`, tested). Behind another app:
  that app is activated again (`NSRunningApplication`); hidden: `NSApp.hide`.
- A page loaded again (a crashed webview) forgets the note: frame back, opaque (`forget`), so the
  window never stays unseen.
- A page that never says it painted (broken, its crash notice showing, or hung)
  leaves the window opaque 1.5 s after the note opened or closed (`PAINT_DEADLINE`, its own
  thread for that moment only): the page answers in 35-600 ms, and a window on screen and unseen
  could not even show the crash notice's Reload. Each open or close has its own deadline, which
  a later one or the page's answer makes moot.
- The window's getters run before the state's lock: off the main thread a getter waits for it,
  which a press holding the lock on the main thread would never answer.
- System parts in `infrastructure/window/` (opacity, traffic lights, the app in front); no new
  crate, five `objc2-app-kit` features.
- The note's keys stop at its root: the layout's window listeners, which skip fields but not
  `⌘K`, `⌘,`, `⌘N`, never see them.

## Measures

- Prototype on macOS 27, debug build with Vite (`.local/quick-note/`, `drive.py` drives the cases
  through the single instance): from the shortcut to the note opaque 60-155 ms, the first after
  launch ~600 ms; the layout opaque again 35-49 ms after it shows. From minimized ~590 ms: the
  system's animation out of the Dock.

## Decisions

- The main window's WebView, not a second window (the maintainer): a WebView made on
  the spot takes 250-320 ms and 200-300 MB, one kept ready ~90 MB (`capture.md`, Measures); the
  main one costs nothing more. Not the full window with the field focused: it would cover what
  the user was looking at.
- The Inbox unless chosen (the maintainer): a note
  whose place is known goes there without a later Move. Not the project last on screen. The
  destination is a second field below the note, not chips inside it nor `#list` in its text:
  writing comes first and the Inbox costs no key; the field is Move's own, one way to choose a
  place everywhere.
- Added to the Inbox, then moved: no second path for new lists, images and
  failures; the cost is one write more (about 5 ms).
- The field alone, no header nor bordered box: a header would repeat the Inbox's, a box
  inside a box. Fixed height: notes are short, and a growing window
  resizes at each line. No capture icon: capture has its own shortcut.
- The draft kept on `Esc` and a click outside: a click by mistake loses nothing.
- Minimized: the system's animation accepted: only the first note after a manual
  minimize, no public API skips it.
- Native full screen: the box centered in Sidekyk's Space, over leaving full screen
  (about a second each way) or showing the full window (moves the user off their project).
