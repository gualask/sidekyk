# Syntax colors

Both sides of a diff, and any file shown, colored from their whole versions.

## Behaviour

- One Dark / One Light (Zed's `one.json`, from Atom's One, MIT) as `--ui-syntax-*` tokens. Unknown
  files stay in the text's color, as in Zed and VS Code.
- A Markdown file's fenced code takes its language's tones (two-face's grammar embeds them), its
  plain words the text's color (`markup.raw.code-fence`, not a string's `markup.raw`;
  2026-10-25), in the code and in the preview's code blocks (`previews.md`).
- Limits: 1 MiB per version ("No colors" in the header); lines past 4,000 bytes keep the text's
  color (a minified line: 4,000 B 29 ms, 32,000 B 1.9 s); coloring stops after 2 s.

## How it is built

- `get_syntax_colors` (`modules/syntax/`): `{ path, version, first, count ≤ 2,048 }`, version
  `worktree` (`read_entry`, links never followed), `index`, `head` or `commit` (`git cat-file blob
  <rev>:<path>`, ids must be hashes). A diff's old side is the index (unstaged), HEAD (staged, the
  path before a rename) or the parent commit; its new side the worktree, index or commit.
- syntect + two-face: grammar by file name, extension, then first line (`#!`). Theme items are 17
  tones, so syntect's scope matching folds scopes. Spans per line in UTF-16 offsets, touching ones
  of one tone merged; each line carries `check` (FNV-1a of its UTF-16 units).
- `ColorCache` (`cache.rs`): a thread of its own, started on the first text, idle on its channel;
  it alone holds the parser states (oniguruma regions cannot leave their thread). The last 4
  versions' lines are kept in a table callers read without it. Jobs run in order; one whose text
  was colored meanwhile is answered from the table; a newer text of a file stops the older run and
  its caller reads again (3 times, then gets the last colors, which `lineCheck` filters). A panic
  loses that text's colors, not the thread.
- A changed version is colored from the last (`colors.rs`, as VS Code): the state kept every 64
  lines; from the last one at or before the first changed line until, in the unchanged tail, the
  state equals one kept there, whose lines are reused, shifted.
- Frontend: `DiffList` asks for the 256-line blocks on screen (`useSyntaxColors`); a line takes its
  colors only when `lineCheck(text)` matches, so colors never land on other text. Worktree blocks
  are invalidated by every change, index and HEAD ones when the git dir changed, commit ones never.
- Measured: Zed's largest source file (885 KiB, 23,205 lines) 0.64 s, a kept block 0.4 ms, one line
  edited 8-9 ms.

## Decisions (2026-10-18)

- `syntect` 5.3 (oniguruma) with `two-face` (bat's ~220 grammars), one engine for every language.
  Tree-sitter is 4-10x faster (Zed's `editor.rs`, 13,291 lines: 74 vs 344 ms) but a grammar crate
  per language and 4-25 MB per grammar on first use; two-face 7-16 MB whatever the language,
  ~2 ms to load. Not: tree-sitter plus a two-face fallback (41 crates, two engines); `giallo` (as
  slow, 42-98 MB, young); `tree-sitter-language-pack` (26 MB of native libraries a hardened app
  refuses); Shiki in the WebView (heavy work stays in Rust).
- Colored again from the change, not whole (`syntax_colors_while_written`, a file written every
  250 ms): whole, a 5,192-line file had 0 of 19 answers in time and kept a core busy; from the
  change, 19 of 19 in 8-9 ms and 0.18 s CPU.
