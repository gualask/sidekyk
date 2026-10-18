# Syntax colors

Both sides of a diff, and any file shown, colored from their whole versions.

## Behaviour

- One Dark / One Light (Zed's `one.json`, from Atom's One, MIT), as `--ui-syntax-*` tokens.
  Unknown files stay in the text's color, as in Zed and VS Code.
- Limits: 1 MiB per version (`tooLarge`, "No colors" in the header); lines past 4,000 bytes keep the
  text's color (a minified line: 4,000 B 29 ms, 32,000 B 1.9 s); coloring stops after 2 s.
- Not tried in the packaged app yet (`ROADMAP.md`).

## How it is built

- `get_syntax_colors` (`modules/syntax/`): `{ path, version, first, count ≤ 2,048 }`, version
  `worktree` (`read_entry`, links never followed), `index`, `head` or `commit` (`git cat-file blob
  <rev>:<path>`, ids must be hashes). A diff's old side: index (unstaged), HEAD (staged, the path
  before a rename), the parent commit; its new side the worktree, index or commit.
- syntect + two-face: grammar by file name, extension, then first line (`#!`). Theme items whose
  color is a tone (17 tones: comment, string, keyword…), so syntect's own scope matching folds
  scopes. Spans per line in UTF-16 offsets, merged when touching with one tone; each line carries
  `check` (FNV-1a of its UTF-16 units).
- The largest source file of Zed's clone (885 KiB, 23,205 lines): 0.64 s; a kept block 0.4 ms.
- `ColorCache` (held by `Repositories`, `cache.rs`): a thread of its own, started on the first text
  colored, idle on its channel; it alone holds the parser states (oniguruma regions cannot leave
  their thread). The last 4 versions' lines are kept in a table callers read without it (key:
  root, path, version; bytes hashed at each request). Jobs run in order; one whose text was colored
  meanwhile is answered from the table, one with a newer text of its file queued behind it with
  `None` (its caller reads the file again, 3 times, then gets the file's last colors, which
  `lineCheck` filters); a newer text stops the run of an older one. Bytes become text on the
  thread, only to color. A panic loses that text's colors, not the thread.
- A changed version is colored from the last (`colors.rs`, as VS Code): the state kept every 64
  lines; from the last one at or before the first changed line, until, in the unchanged tail, the
  state equals one kept there, whose lines and states are reused, shifted. A line edited in 23,205:
  8-9 ms; an unclosed comment colors to the end.
- Frontend: `DiffList` asks for the 256-line blocks of the rows on screen (`useSyntaxColors`,
  `model/syntax.ts`); a line takes its colors only when `lineCheck(text)` matches, so colors read
  before a change never land on other text. Worktree blocks are invalidated by every change,
  index/HEAD ones only when the git dir changed, commit ones never.

## Decisions (2026-10-18)

- `syntect` 5.3 (oniguruma) with `two-face` (bat's ~220 grammars), one engine for every language.
- Measured (Apple Silicon, one thread): tree-sitter 4-10x faster (Zed's `editor.rs`, 13,291 lines:
  74 ms vs 344 ms) but 1 grammar crate per language, 4-25 MB of memory per grammar on first use
  (SQL +22 MB, Swift 114 ms to load); two-face 7-16 MB whatever the language, ~2 ms to load.
  Rejected: hybrid tree-sitter (arborium grammars) + two-face fallback (41 crates, two engines);
  `giallo` (VS Code grammars: as slow as syntect, 42-98 MB, young); `tree-sitter-language-pack`
  at runtime (26 MB download of native libraries, ad-hoc signed: a hardened-runtime app refuses
  them; TypeScript query without its JavaScript base); Shiki in the WebView (heavy work stays in
  Rust).
- Coloring again after a change as VS Code does: measured first on a file written every 250 ms
  while on screen (`syntax_colors_while_written`). Whole each time, a 5,192-line file showed 0 of
  19 answers in time (each new text stopped the run of the last) and kept a core busy (5.2 s CPU
  in 5.2 s); from the state before the change, until the state meets one kept past it: 19 of 19 in
  8-9 ms, 0.18 s CPU (23,205 lines: 0.22 s, 8-9 ms per write instead of 650 ms). Coloring runs on
  a thread of its own: syntect's parser states hold oniguruma regions, which cannot leave their
  thread (no `unsafe`).
