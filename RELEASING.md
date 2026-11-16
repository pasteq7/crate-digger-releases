# Releasing Crate Digger

Canonical source and release repository: https://github.com/pasteq7/crate-digger-releases.
The repository name is retained because installed apps already use this update feed.

## Normal release: GitHub Actions

1. Finish the requested changes, run `npm test` and `npm run build`, and run the focused desktop tests appropriate to the changes. `npm run test:desktop` covers the Quiet Collection library/player and AI discovery; `npm run test:collection` covers popup placement, inline albums, liked-track import/refresh, filtered playback across pages, and recovery from sample mode; `npm run test:external` covers Tasks and reviewed imports. For updater changes, use `npm run test:updates`. `npm run test:codecs` is an optional local codec check requiring FFmpeg to generate audio fixtures; FFmpeg is not shipped or required to run the app.
2. Choose a new semantic version. Run `npm version patch --no-git-tag-version` for a bug fix, or replace `patch` with `minor` for a feature. This updates both package files. Never reuse a published version.
3. Add user-facing notes in `docs/releases/v<version>.md`. Use `docs/releases/v0.4.1.md` as an example of structure, not as the content for later releases.
4. Commit the tested source, version files, and release notes. Confirm `git status --short` is empty and the Git remote is the canonical repository. Then run, substituting the actual version:

   ```powershell
   git push origin main
   git tag v0.4.2
   git push origin v0.4.2
   ```

5. The **Windows release** workflow validates the tag/version, installs dependencies, runs unit, updater, library/player, AI, and Tasks/import desktop tests, builds the Python importer and NSIS installer, and checks the packaged executable. Test, installer, and packaged-app checks have separate bounded steps. It sets `CRATE_PYTHON` to its importer environment for generated fixture imports; the import smoke test waits for external handoff cleanup before closing its isolated app. A tag push creates a **draft** release with the three required update assets. A manual workflow run performs the same build and tests and uploads a workflow artifact, without creating a release.
6. Wait for the actual run to finish. For example:

   ```powershell
   gh run list --repo pasteq7/crate-digger-releases --workflow windows-release.yml --limit 5
   gh run watch <run-id> --repo pasteq7/crate-digger-releases --exit-status
   gh release view v0.4.2 --repo pasteq7/crate-digger-releases --json url,isDraft,assets
   ```

7. Review the release notes and verify every required asset is uploaded and nonempty:

   - `Crate-Digger-Setup-<version>.exe`
   - `Crate-Digger-Setup-<version>.exe.blockmap`
   - `latest.yml`, whose version, filename, size, and SHA-512 describe that installer

8. When publication is authorized, publish the verified draft:

   ```powershell
   gh release edit v0.4.2 --repo pasteq7/crate-digger-releases --draft=false --latest
   ```

   Confirm it is public and latest with `gh release view` and `gh api repos/pasteq7/crate-digger-releases/releases/latest --jq .tag_name`. A future agent should report the release URL and successful checks, or the concrete blocker. Do not claim publication from a successful source push or draft creation alone.

The workflow skips a tag whose release already exists, leaving its assets unchanged. If a workflow fails, inspect its logs and fix the cause. Never overwrite a published version. A manually created incomplete draft may be repaired only after verifying it is still a draft and matching its tested source/tag; do not blindly delete releases or move tags.

## Local fallback

Use Windows x64, Node.js 22.18 or later, Python 3.12, Git, and an authenticated GitHub CLI. Install the importer environment once:

```powershell
npm ci
py -3.12 -m venv .importer-venv
.\.importer-venv\Scripts\python.exe -m pip install -r scripts/importer-requirements.txt
```

After the normal version, notes, commit, and tag steps, run `npm run release:draft`. This builds locally and uploads a draft. Use this fallback only when the workflow is unavailable or disabled, so the two publishers cannot race. If needed, disable it with `gh workflow disable windows-release.yml` before pushing the tag and re-enable it with `gh workflow enable windows-release.yml` after the fallback release. The script requires a clean checkout, a matching local tag, a remote tag, and version-specific release notes. It validates the installer metadata and refuses to overwrite an existing release. `npm run dist` only builds. `node scripts/release-draft.mjs` uploads an already built installer as a draft; add `--validate-only` to check source/tag/metadata without uploading.

For an isolated check of a built package, run `node scripts/package-smoke.mjs`. The additional `node node_modules/electron/cli.js scripts/update-transport-smoke.mjs` downloads the built installer through a loopback feed and verifies the real updater's checksum handling without installing it. These checks do not update the user's installed app.

## Update behavior and constraints

- Installed copies check 15 seconds after launch and every six hours. Settings also provides a manual check and an automatic-download preference.
- Downloads are automatic; installation waits for **Restart to update**. Running or starting imports, scans, and external commands block restart.
- Keep the same app ID, product name, per-user NSIS installation, and update repository. User data stays in `%APPDATA%/Crate Digger/`; never package that directory.
- Uploading source commits does not update installed apps. Only a newer **published stable release** with all required assets does.
- The first updater-enabled version is 0.4.1. Older copies need a manual installer upgrade once. Unpacked and development copies do not install updates.
- The current installers are unsigned. Keep the current signing status explicit; if signing is introduced, test the transition on an existing installation and document it here.
