# Crate Digger agent instructions

This repository contains the Electron/React Windows app and its GitHub Releases update feed. Preserve `local.cratedigger.desktop`, the product name, and the release repository `pasteq7/crate-digger-releases`: existing installations depend on them.

## Work and validation

- Keep user music read-only except for explicitly requested import operations. Preserve the existing user-data directory, database, credentials, and settings across upgrades.
- Follow the sandboxed preload and sender-validated IPC patterns for native features.
- Use `npm ci` for a fresh checkout. Run `npm test` and `npm run build` after code changes, plus focused desktop/import tests when the changed behavior warrants them. Tests must use isolated profiles and generated music.
- Never commit `.env` files, API keys, local databases, user music, test profiles, installed dependencies, Python environments, build output, or installers. Generated output belongs in ignored directories or release assets.

## Releasing a feature or fix

Read [RELEASING.md](RELEASING.md) before preparing or uploading a version. That file is the maintained release procedure; do not depend on earlier chat history.

- A feature request authorizes implementation and validation. Publish a public release when the user requests or has already authorized it; otherwise prepare a draft for review. Do not ask again for publication the user already authorized.
- Bump `package.json` and `package-lock.json` together. A version tag must point to the tested source commit with the same version. Never move an existing published tag or replace assets for a published version; use a higher version for fixes.
- Prefer the tag-triggered Windows workflow. A successful source push alone does not release an app update. Wait for the workflow to complete and verify the installer, `.exe.blockmap`, and `latest.yml` before publishing the draft.
- Published stable GitHub Releases are discovered by installed apps. Drafts and prereleases are excluded. Users on versions older than 0.4.1 need one manual installer upgrade to enable updates.
- Keep `RELEASING.md`, this file, and the workflow accurate if release commands or prerequisites change. Update release notes to describe the actual changes.
