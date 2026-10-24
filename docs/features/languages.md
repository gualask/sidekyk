# Languages

The UI in English and Italian: the frontend's text, and what the backend writes for the user
(tray, dialog titles, an export of notes, a project's first list).

## Behaviour

- Settings › Appearance › Language: `English`, `Italiano`, each by its own name. Changes apply at
  once, without reloading the page; the tray menu follows.
- First start: the system's language (`navigator.languages`, the first one the UI speaks, else
  English), stored in the settings; from then on only the setting counts. No "System" option, as
  the theme has none.
- Dates and numbers: the system's variant of the UI's language (`en-GB` for English on a British
  system), else the language alone (`formatTag`).
- Short times in rows: `now`, `5m`, `3h`, `2d`, `1w`, `4mo`, `2y`; `ora`, `5 min`, `3 h`, `2 g`,
  `1 sett`, `4 mesi`, `2 anni`. A column of them is as wide as the language's longest
  (`relativeTimeWidth`).
- Key names stay as printed on keys (`Ctrl`, `Alt`, `Shift`, `Space`).
- Text that leaves the app follows the UI's language: the copy marker `(removed in a1b2c3d)` /
  `(rimosso in a1b2c3d)`, the exported Markdown's headings, the first list (`General` /
  `Generale`, kept once created).
- Not translated: git's and the backend's own errors without a code (`unknown`): technical, shown
  as they come.

## How it is built

- Frontend (`src/shared/i18n/`): flat catalogs `messages/en.json` and `messages/it.json`, dotted
  keys by area (`notes.deleted`, `palette.inFiles.other`), `{name}` placeholders. A text several
  areas show is `common.*` (`common.close`, `common.goTo`): an area's keys are its own to change.
  - English is the source of the keys: `MessageKey` is `keyof` its catalog; another catalog
    missing a key fails `tsc`.
  - `useTranslation()` gives a `Translator`: `t(key, values)`, `tp(key, count, values)` (plural by
    `Intl.PluralRules`; a form the catalog lacks, as Italian `many`, takes `other`), `locale`,
    `formatTag`. Pure functions take the `Translator` as their last argument.
  - `RichText` fills placeholders with elements (`<kbd>`, `<code>`).
  - Maps from values to text hold `MessageKey`s (`CHANGE_MARK_WORD`, panel titles, error codes in
    `app-error.ts`); the caller translates.
  - The app's `TranslationBridge` (`AppProviders`) picks the language: the setting, else the
    system's, which it stores. Outside it (tests, fixtures) the context gives English.
  - The window, created hidden, shows once projects and settings are read (`AppShell`): its first
    frame is already in the stored language.
- `pnpm i18n:check` (`scripts/check-i18n.mjs`, in the checks): every catalog has English's keys
  and placeholders; every key is used by the code (string literals, parsed with Vite's parser,
  tests and `src/dev` excluded); no key built at runtime, which could not be seen as used.
  Removing the code of a text without its keys fails it.
- Backend: `Settings.language` (`Option<Language>`, `None` until the first start stores one).
  `interfaces/tauri/texts.rs` holds the Rust text, one `Texts` per language (the struct makes
  both complete): tray menu, dialog titles, export file name and `ExportWords`, the
  first list's name (`NotesStore::name_first_lists`). Startup and `set_settings` apply it
  (`tray::speak`).

## Decisions

- 2026-10-20: own code over a library. Compared on npm the same day: i18next 26.5 (13.5 kB gzip;
  its `i18next-cli` for unused keys, 86 dependencies, 16 MB), Lingui 6.10 (catalogs extracted from
  the source, `extract --clean`; its macros need Babel in the Vite 8 build, 107 dependencies),
  react-intl 12.1, Paraglide 2.29 (215 MB of dependencies), Fluent (`@fluent/react` last released
  2023-08). For two languages and ~330 strings none adds what we need; the check gives the
  unused-key safety. Pattern from Fyler, English as the source instead of Italian.
- 2026-10-20: `navigator.languages` over a Rust locale crate: WKWebView reports the system's
  languages (`it-IT`) inside an `.app` bundle with or without `CFBundleLocalizations` (tried with
  a Swift harness). WebKitGTK and WebView2: to try (`ROADMAP.md`).
- 2026-10-20: two options, no "System": as the theme; the first start takes the system's.
