# Languages

The UI in English and Italian: the frontend's text, and what the backend writes for the user
(tray, dialog titles, an export of notes, a project's first list).

## Behaviour

- Settings › Appearance › Language: `English`, `Italiano`, each by its own name; applied at once,
  the tray menu too.
- First start: the system's language (`navigator.languages`, the first the UI speaks, else
  English), stored; from then on only the setting counts. No "System" option, as the theme.
- Dates and numbers in the system's variant of the UI's language (`en-GB` on a British system),
  else the language alone (`formatTag`).
- Short times in rows: `now`, `5m`, `3h`, `2d`, `1w`, `4mo`, `2y`; `ora`, `5 min`, `3 h`, `2 g`,
  `1 sett`, `4 mesi`, `2 anni`; a column of them as wide as the language's longest
  (`relativeTimeWidth`).
- Key names as printed on keys (`Ctrl`, `Alt`, `Shift`, `Space`).
- Text that leaves the app follows the UI's language: the copy marker `(removed in a1b2c3d)`, the
  export's headings, the first list (`General` / `Generale`, kept once created).
- Not translated: git's and the backend's errors without a code (`unknown`), shown as they come.

## How it is built

- Frontend (`src/shared/i18n/`): flat catalogs `messages/en.json` and `messages/it.json`, dotted keys
  by area, `{name}` placeholders; a text several areas show is `common.*`, so an area's keys are
  its own to change. English is the source: `MessageKey` is `keyof` its catalog, so a key missing in
  Italian fails `tsc`.
- `useTranslation()` gives a `Translator`: `t(key, values)`, `tp(key, count, values)` (plural by
  `Intl.PluralRules`; a form the catalog lacks takes `other`), `locale`, `formatTag`. Pure
  functions take it as their last argument. `RichText` fills placeholders with elements. Maps from
  values to text hold `MessageKey`s; the caller translates.
- `TranslationBridge` (`AppProviders`) picks the setting, else the system's language, which it
  stores; outside it (tests, fixtures) English. The window shows once settings are read, so its
  first frame is in the stored language.
- `pnpm i18n:check` (`scripts/check-i18n.mjs`): every catalog has English's keys and placeholders;
  every key is used by the code as a string literal (parsed with Vite's parser, tests and
  `src/dev` excluded); no key built at runtime.
- Backend: `Settings.language` (`None` until the first start stores one); `interfaces/tauri/texts.rs`,
  one `Texts` per language (the struct makes both complete): tray menu, dialog titles, export name
  and words, the first list's name. Applied at startup and by `set_settings` (`tray::speak`).

## Decisions

- Own code over a library (2026-10-20). Compared on npm that day: i18next 26.5 (13.5 kB gzip; its
  CLI for unused keys 86 dependencies, 16 MB), Lingui 6.10 (macros need Babel in the Vite 8 build,
  107 dependencies), react-intl 12.1, Paraglide 2.29 (215 MB of dependencies), Fluent
  (`@fluent/react` last released 2023-08). For two languages and ~330 strings none adds what we
  need; the check gives unused-key safety. Pattern from Fyler, English as source.
- `navigator.languages` over a Rust locale crate (2026-10-20): WKWebView reports the system's
  languages inside an `.app` with or without `CFBundleLocalizations` (a Swift harness). WebKitGTK
  and WebView2: to try (`ROADMAP.md`).
