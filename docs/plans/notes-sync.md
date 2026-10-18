# Plan: notes sync (Google Drive)

Optional backup/sync of the notes (`../features/notes.md`); nothing leaves the machine and nothing
runs until an account is connected.

## Facts (checked 2026-10-11)

- Scopes: `drive.appdata` (hidden app folder) or `drive.file` (files visible in Drive), both
  non-sensitive.
- Desktop OAuth: "Desktop app" client, loopback redirect on a random port, PKCE S256; the client
  secret is not secret; OOB and custom schemes unsupported.
- Refresh tokens expire after 7 days while the Cloud project is "Testing"; real use needs
  "Production". They also die on revocation, six months unused, or past 100 per account.

## Design

- Tokens in the OS credential store only; on Linux without a Secret Service, sync stays off.
- Local first, sync in the background after edits (debounced), at startup and on focus, never
  polling; network only in Rust; conflicts keep both versions (one file per note: a conflict is
  one note).
- A setting in Notes (settings dialog).

## Rules when it lands

`AGENTS.md` then says: sync is the first network access, backend only.

## Open

- `drive.appdata` or `drive.file`; conflict strategy; client-side encryption.

## Sources

- [Choose Google Drive API scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)
- [Store application-specific data (appDataFolder)](https://developers.google.com/workspace/drive/api/guides/appdata)
- [OAuth 2.0 for iOS & desktop apps](https://developers.google.com/identity/protocols/oauth2/native-app)
- [Using OAuth 2.0 to access Google APIs: refresh token expiration](https://developers.google.com/identity/protocols/oauth2)
