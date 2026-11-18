# Updates and releases

The app updates itself from GitHub Releases; a tag builds and publishes a release.

## Behaviour

- Checked once the window is idle after startup, then when the window shows a day after the last
  check (React Query's refetch on the page's `visibilitychange`), or from Settings, About,
  Updates, Check for updates. No timer: a hidden app asks nothing. A development build
  (`tauri dev`) has nothing to update.
- A newer version: a toast once per version, with Update; the Settings row says it too. Update
  downloads it (the percent in the row's button), checks its signature, puts it in place of the
  app and restarts it. On Windows its installer takes over (passive mode) and the app exits. A
  failure is a toast and leaves the app as it was.
- The source: `latest.json` of the latest published release (`plugins.updater.endpoints`); a
  draft is never offered.

## How it is built

- `desktop/update.rs`: the check, the update it found (installed from there, one install at a
  time), the download's whole percents. Rust only: no JS package, no `tauri-plugin-process`
  (`AppHandle::restart`). Commands `check_update`, `install_update` and the `update-progress`
  event in `interfaces/tauri/update.rs`; the page's side in `modules/settings`
  (`application/updates.ts`, `ui/UpdateSetting.tsx`).
- One version, `[workspace.package]` in `src-tauri/Cargo.toml`: `tauri.conf.json` and
  `package.json` have none, so the bundle, the updater and the log read the same.
- Each installed copy looks in `latest.json` for `{os}-{arch}-{installer}` (the bundle type the
  bundler writes into the binary), then `{os}-{arch}`. macOS replaces the `.app` from
  `.app.tar.gz`; Linux replaces the AppImage in place, or installs the `.deb` (`dpkg -i`) or `.rpm`
  (`rpm -U`) through `pkexec`, else a graphical or terminal `sudo`; Windows runs the NSIS or MSI
  installer it came from.

## Release

- To release, commit the version in `src-tauri/Cargo.toml` and `Cargo.lock`, then push the
  matching `vX.Y.Z` tag. The release queue runs one tag at a time and holds up to 100 pending
  runs. After the version check, `release.yml` creates a draft with generated notes.
- macOS and Linux can build as soon as the draft exists. Windows also needs the x64 WSL helper.
  Each build uploads its installers and signatures to that draft while `ci.yml` runs. Checks
  alongside, not first: the builds are the long part, and a failed check costs only their runner
  time.
- If the tag and workspace version differ, the version check fails before draft creation.
  Correct the mismatch and push the matching tag. To reuse a tag after a failed release,
  delete any draft for that tag and the tag itself before pushing it again.
- Builds: macOS one universal `.dmg` and `.app.tar.gz` (`--target universal-apple-darwin`); Linux
  on Ubuntu 22.04, the oldest runner, for the oldest glibc: AppImage, `.deb`, `.rpm`; Windows x64,
  NSIS and MSI with the helper. Each update has its `.sig`. Only the app's binary is compiled
  (`-- --bin sidekyk`): cargo would build every default member, `sidekyk-agent` among them.
- Duration, v0.1.0 with cold caches and the checks first: 48 min from the tag. Checks and helper
  8 min; builds, release profile (LTO, one codegen unit), Linux 16, Windows 24, macOS 39 (arm64
  19.8 and x86_64 16.0 compiling, one after the other), under its 60-minute limit.
- `tauri.release.conf.json` turns `createUpdaterArtifacts` on for releases only: no other build
  has the updater's private key, and the bundler refuses a public key without it.
- After all builds and checks pass, `publish` generates `latest.json` from the draft's uploaded
  installer and signature pairs. Each entry uses the installer's asset URL and its matching
  `.sig` contents. A missing or ambiguous installer or missing signature blocks publication.
  The job uploads the manifest, reads it back and checks the bytes before publishing. After a
  transient manifest upload or read error, re-run the failed job against the same draft.

## Signatures

- Updates: a minisign key pair (`tauri signer generate`); the public key in `tauri.conf.json`,
  the private key and its password in the secrets `TAURI_SIGNING_PRIVATE_KEY` and
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. A new key pair: installed copies refuse every update and
  are reinstalled by hand.
- macOS code: "Sidekyk Release Signing", a self-signed code-signing certificate (RSA 3072, to
  2046), as a `.p12` in `MACOS_CERTIFICATE` (base64) and `MACOS_CERTIFICATE_PASSWORD`. The
  workflow imports it into a keychain of its own and names it by SHA-1
  (`APPLE_SIGNING_IDENTITY`); Tauri's `APPLE_CERTIFICATE` cannot take it (it reads a team from the
  certificate's organizational unit). The designated requirement becomes `identifier
  "io.github.gualask.sidekyk" and certificate leaf = H"<sha1>"`, the same at every release, so
  macOS's privacy grants (Screen Recording for capture) outlive updates; an ad-hoc signature
  changes with each build and loses them. The release stays a draft unless
  `codesign --verify --deep --strict` passes and the requirement shows that leaf.
- Losing or rotating that key: every user grants Screen Recording again. A stolen key signs code
  that inherits the grants: a secret, like the updater's. The bundle identifier and
  `/Applications` stay fixed: the grants key on them too. The key files are kept outside the
  repository, with a backup: a GitHub secret cannot be read back.
- Windows: unsigned; SmartScreen warns before the installer runs.

## macOS without notarization

- No Apple Developer Program (99 $/year), so no notarization: Gatekeeper blocks a downloaded
  `.dmg`'s app at its first launch ("Apple could not verify…", Move to Trash, Done). From macOS
  15 the Finder's Control-click, Open no longer bypasses it: System Settings, Privacy & Security,
  Open Anyway, then the password; or `xattr -dr com.apple.quarantine /Applications/Sidekyk.app`.
  Both in the README. Seen on macOS 27.2 with a `.dmg` downloaded by Safari and dragged by the
  Finder; `open` from a terminal shows no prompt and proves nothing.
- Updates bring no prompt: the updater downloads in Rust and swaps the bundle, and an unsandboxed
  app without `LSFileQuarantineEnabled` sets no quarantine. Seen on macOS 27.2: the updated
  bundle had no `com.apple.quarantine`, opened at once and kept Screen Recording.

## Decisions

- No timer for the check (`AGENTS.md`, Performance): at startup, on show after a day, on demand.
- No Homebrew cask: the official repository disables casks that fail Gatekeeper (Homebrew 5.0)
  and `--no-quarantine` is gone; a tap would have to clear the flag itself.
- No `curl | bash` installer that skips quarantine: a script from the network for a prompt.
- No portable Windows copy: the updater downloads an installer, which a copy without one would
  not match.

## Sources

- Tauri, macOS code signing: https://v2.tauri.app/distribute/sign/macos/
- Updater install per system: tauri-apps/plugins-workspace, `plugins/updater/src/updater.rs`;
  `latest.json`'s keys: tauri-apps/tauri-action, `src/upload-version-json.ts`;
  `APPLE_CERTIFICATE`: tauri-apps/tauri, `crates/tauri-macos-sign/src/keychain/identity.rs`.
- Homebrew 5.0.0: https://brew.sh/2025/11/12/homebrew-5.0.0/
- A self-signed certificate keeps TCC grants: https://github.com/koekeishiya/yabai/wiki/Installing-yabai-(from-HEAD)
- Gatekeeper without notarization: https://eclecticlight.co/2024/10/01/living-without-notarization/,
  https://mjtsai.com/blog/2024/07/05/sequoia-removes-gatekeeper-contextual-menu-override;
  quarantine set by whom: https://eclecticlight.co/2025/12/08/who-decides-to-quarantine-files/
