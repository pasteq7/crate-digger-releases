# Crate Digger

A private little record store, built around the music you already own. A local Windows desktop app with a dark-first interface, large album artwork, and a persistent preview player.

## Run

The Windows installer is `release/Crate-Digger-Setup-0.4.1.exe`. It installs for your user, without administrator access or a separate server. The build is unsigned. Install this version once to enable future automatic updates; older builds do not have an updater. Published installers are hosted in [GitHub Releases](https://github.com/pasteq7/crate-digger-releases/releases).

Source code, build instructions, and releases share this repository. For future releases, follow [RELEASING.md](RELEASING.md). AI contributors should start with [AGENTS.md](AGENTS.md), which points to that maintained procedure. Pushing a version tag runs the Windows release workflow and prepares a draft with the updater files.

### App updates

The installed Windows app checks for stable releases 15 seconds after launch and every six hours. Available updates download in the background. **Settings → App & updates** shows the current version, download progress, **Check for updates**, and an automatic-check/download preference. The preference saves immediately and works in both your library and the sample collection.

After downloading, a banner and Settings offer **Restart to update**. Restart is blocked while an import, library scan, or external command is active. Closing the app normally does not install updates. Your library database, API keys, preferences, and music remain in their existing locations. Offline failures can be retried. Development builds and the unpacked executable explain that an installed copy is required and never attempt an update.

Releases use `electron-updater` with the existing NSIS installer and public GitHub release files. Version checks and installer downloads contact GitHub without sending your library metadata. No GitHub token is shipped in the app. Draft releases and prereleases are excluded from normal checks.

To ship a subsequent version:

1. Increment `package.json` and the lockfile version with `npm version patch --no-git-tag-version` (or the appropriate minor/major version).
2. Run `npm test`, `npm run build`, and `npm run test:updates`.
3. Add version-specific release notes, commit and push the tested source, then tag that commit with the matching version. The Windows release workflow builds and prepares a draft with the versioned `.exe`, `.exe.blockmap`, and `latest.yml`. See [RELEASING.md](RELEASING.md) for exact commands and the local fallback.
4. Wait for the workflow to finish, review the draft, and publish it when authorized. Installed copies discover the new stable release on their next check.

The importer build prerequisites are documented below. `npm run dist` only builds; it never publishes. Run `node scripts/release-draft.mjs` to upload an already built version as a draft. The release script refuses to overwrite an existing version.

Version 0.4.0 simplifies navigation to Discover, Wishlist, and Import music. Taste and Settings stay at the bottom. Folder and genre filters live inside Discover, with additional catalog controls under Browse options. External music links are available in record details. The player appears when a record is selected for playback.

Saved records have an explicit Remove action with Undo, plus bulk removal. Previous Maybe choices migrate to Wishlist. Less like this hides a release, informs AI discovery, and lowers similar artists and genres in catalog ranking without banning them. Review or restore these choices from Settings → Discovery feedback.

Watched music folders trigger a debounced scan when files or subfolders change, in addition to the five-minute fallback scan. Scans automatically remove owned matches from Wishlist (album editions and artist spelling are normalized; tracks are matched individually). ZIP and folder imports also reconcile Wishlist after indexing. Turn off Watch folders for new music to use manual scans only.

For development, install Node.js 22.18+ and run:

```powershell
npm ci
npm run dev
```

For a production run from source:

```powershell
npm run build
npm start
```

`npm run dev:web` opens a browser preview on `http://127.0.0.1:5178`. It supports the explicitly labeled sample collection. Folder access and SQLite are native desktop features, so launch Electron to scan your music.

If Electron's standard runtime downloader stalls on your network, `node scripts/download-runtime.mjs` uses HTTPS streaming and verifies the official published SHA-256 before extracting the runtime.

## First visit

Choose a music folder. The scanner works in the background, and discovery starts as soon as the first tracks are indexed. Add more music folders in Settings. You can explore a separate sample collection first; sample shelves never become your personal library or shelves.

The scanner reads MP3, FLAC, M4A, AAC, OGG, Opus, WAV, AIFF, WMA, APE, and WavPack. It reads artist, album, genre, and year tags. Missing tags fall back to an `Artist / Album / Track` folder layout, including disc subfolders and year prefixes. Flat untagged folders cannot identify the artist reliably and display “Unknown artist.” Files without genres appear as “Untagged.”

Scans compare modification time and size. They update changed files, remove missing entries after a successful directory walk, and preserve entries for unavailable roots. Unreadable and malformed files use fallbacks or contribute to the scan warning count. Symbolic links are skipped to avoid loops. Scans run at launch and every five minutes by default; disable automatic rescans or rescan manually in Settings. Overlapping root folders are prevented.

**Library scans are read-only.** Explicitly dropping a folder into Import music authorizes tagging and moving that folder; the app stages and verifies copies before removing the source. ZIP imports tag extracted copies and retain the archive. Existing destination albums are never overwritten. Removing a library folder removes only its index entries.

## Discover

Discover offers **Personal picks** for AI recommendations and **Explore** for catalog browsing. Switch sources in the top bar.

### AI discovery

1. Configure Google Gemini, OpenAI, or a local Ollama model in Settings. Existing provider keys continue to work.
2. Select a genre or folder. Untagged collections can use the folder tree instead of genre tags.
3. Expand **Review what is sent** to inspect the artist/album/year/genre list, logical folder labels, and relevant shelf feedback.
4. Press **Find records**. The AI receives that collection and recommends up to twelve specific albums, with musical connections to one or more albums you own. This is an actual recommendation request, separate from the optional explanation button.
5. The app checks suggested releases against Apple, Deezer, or MusicBrainz and resolves matching preview tracks. **With previews** shows only finds with a matching preview URL. **All records** is the default and includes verified releases without clips, so niche finds are not hidden because of catalog gaps. Pending candidates are labeled; suggestions that cannot be verified are removed.

Choose scope and distance above your results. **Listen mode** skips releases without previews. Cards show the owned albums behind each suggestion, rather than only an artist/genre label. Save and Less like this, keyboard shortcuts, Undo, and Wishlist export work with AI finds.

AI context is deduplicated by album rather than track count. Collections larger than 250 albums use a balanced per-artist sample; the included and total counts are visible. Up to sixty relevant recent shelf choices inform the prompt. Absolute paths, filenames, and audio are never sent. All owned and shelved albums are filtered against the complete local library; rejected editions stay excluded even if the model suggests them. The next batch excludes previous suggestions from the current session.

**AI requests happen only after you press the generation button.** Switching genre, changing distance, browsing shelves, or resizing the app does not trigger a paid AI call. Identical requests are cached locally for seven days; library, feedback, model, or batch changes produce a different request. Changing scope cancels stale generation/enrichment. Provider failures remain visible and never silently substitute tag-search results.

Catalog verification confirms a release exists, not that its stylistic connection is objectively correct. Recommendations still depend on model knowledge and judgment. Preview coverage varies by release and region; the app does not invent preview URLs or promise every AI pick can be previewed. Matching uses a broader track search, album/track-list lookup fallback, and the machine's store region (US if unavailable). Unavailable clips are clearly disabled.

### Catalog browse and shared shelves

- Choose all your music, a folder, or a genre from the discovery scope selector, including nested folders.
- Catalog Safe uses existing tags, Adjacent uses a neighboring-genre map, and Wildcard chooses a genre detour. These are the legacy heuristics, not AI recommendations.
- **Collection gaps** looks through a top artist's discography in the selected scope.
- Save keeps a record in Wishlist. Less like this provides negative discovery feedback and excludes that release and common edition variants. Undo restores the previous choice.
- Drag a card onto Wishlist to save it. Wishlist supports genre/folder grouping, multi-select, bulk removal, and text or CSV export.

### Shortcuts

| Key          | Action                            |
| ------------ | --------------------------------- |
| Space        | Play/pause                        |
| K            | Save to Wishlist                  |
| R            | Less like this                    |
| Left / Right | Previous / next find              |
| S            | Surprise me                       |
| /            | Focus filter                      |
| Escape       | Leave Listen mode / close details |

Shortcuts act on the selected/current find, or the first find. They do not fire while typing in a form field.

## Your taste

The taste view shows genres, top artists, and decades. Genre percentages are based on track counts, with multi-genre tracks sharing their weight. Click a genre to discover within it. The app records a daily library snapshot after a scan; the drift chart appears when at least two dates are available. This measures changes in your collection, rather than listening history.

## Local storage and privacy

Production data lives in `%APPDATA%/Crate Digger/` (Electron's user-data directory):

- `crate-digger.sqlite`, with WAL sidecars: tracks, folders, settings, shelves, API cache, and daily taste snapshots.
- Electron's local browser storage: sample preferences, sample shelves, and playback volume.
- API keys use Electron `safeStorage`, backed by Windows credential encryption. Google and OpenAI keys are encrypted and saved separately; existing keys from v0.1.0 migrate to the OpenAI slot. Keys are not returned to the renderer after saving.

No login, analytics, telemetry, ads, subscriptions, or monetization. No audio files are uploaded. Online lookups send artist/album names and genre queries to MusicBrainz, Apple, and Deezer. Amazon link lookups read public album.link/song.link sharing-page metadata, or MusicBrainz URL relations. Artwork and streamed previews come from their catalog CDNs. There are no remote fonts.

Catalog metadata is cached for seven days; Deezer results use a ten-minute cache because signed preview URLs expire. Previously cached results can be reused when lookups fail, even after expiration. Preview audio is streamed with normal in-memory/browser buffering, never saved as library files. New recommendations and uncached previews require an internet connection. Shelves, taste, scanning, and cached metadata work locally.

### Optional AI

Settings supports no AI (the default), local Ollama, OpenAI, or Google Gemini. Ollama is restricted to a localhost HTTP endpoint; install and start a model yourself first. For OpenAI or Google Gemini, select the provider and enter its API key and model name. Gemini defaults to `gemini-3.8-flash`; you can change it to a model available to your Google project. Get a Gemini API key from [Google AI Studio](https://aistudio.google.com/api-keys). Google requests follow the [Gemini generateContent API](https://ai.google.dev/api/generate-content). **Check connection** lists the Gemini text models available to your entered or saved key without sending library data or generating a response. Choose a listed model and save preferences. This checks authentication and model access, not generation quota. AI failures now show the HTTP status and sanitized provider details, distinguishing invalid keys, denied access, unavailable models, quotas, and outages. Provider usage may cost money independently of this free app. No key is needed for regular discovery.

AI is called only when you press **Find records**, explicitly request extra context in a record's detail panel, or choose “Explain my taste” in the taste view. Discovery requests include the selected collection's album metadata and relative folder labels, as shown in its review panel. A record explanation includes a few library artist names and recommendation context; a taste summary includes aggregated genre, artist, and era counts; explanations and taste summaries do not send folders or audio. The normal one-line reasons always work without AI. API key entry is disabled in the sample collection.

## Folder/ZIP imports and music links

Open **Import music**. The library scan root is reused as the import root unless you choose a different one. **Genre / folder** lists actual existing directories under that root, plus the root itself; it is never populated from a fixed genre list or from genre tags. **Refresh folders** reads the directory structure again. Selected discovery folders/genres are reused only when an actual matching destination exists. Destinations preserve the source name: `Selected folder / original name`.

**Set genre tag to destination folder name** is an independent toggle, off by default. When enabled, the final selected folder name becomes the genre (for example, selecting `Music / Reggae / Dub` writes `Dub`). When disabled, existing genre tags remain unchanged. Comment cleanup has its own checkbox.

Drop a music folder or ZIP into the dedicated box in Import music. Other views have no file-drop target or full-window overlay. ZIP originals are kept. Dropped folders are copied into staging, tagged according to the toggles, verified with SHA-256, published, then their originals are removed. All regular files and empty directories in a dropped folder are preserved, including unknown sidecars. If source removal fails, the sorted copy remains usable and the remaining original location is reported. Existing destination albums are never overwritten; name collisions get a numbered suffix. Symlinks/junctions, system folders, destination ancestors, and folders already in the chosen destination are rejected. ZIPs flatten one redundant wrapper folder, preserve music/artwork/booklets/playlists, and reject unsafe/encrypted entries. Unsupported tag writers restore original extracted bytes and report a note; if genre tagging is enabled a local manifest supplies the chosen genre to the scanner. The importer adapts the routing/tag cleanup approach in `E:\Scripts\music_auto.py`; its watcher and ZIP deletion are not used.

Cards, details, and AI Listen mode have **Amazon Music**, **Copy URL**, and **YouTube search** controls. Amazon links are resolved on demand from verified public sharing-page metadata or MusicBrainz streaming relations, cached locally, and never fabricated. If an exact mapping is absent, the app explicitly opens/copies an artist-and-release search URL for the local Amazon storefront. Public sharing-page markup may change; search remains the fallback. YouTube opens an external search for the specific artist and album, without an API key or downloaded audio.

### External programs

In **Settings → External program**, save a command such as `"C:\Tools\program.exe" {amazonUrl} -option1 -option2`. The terminal button beside **Copy URL** runs that command with the same resolved Amazon URL used by the copy control. Without `{amazonUrl}`, the URL is inserted immediately after the executable name. Quote paths and arguments containing spaces. Programs are launched directly, without a shell; for scripts, specify the interpreter and put `{amazonUrl}` after the script path. Shell pipes and redirection are not interpreted.

Choose a custom working folder or the root containing the currently selected discovery folder. With one scanned root, it is used automatically. With several roots and no selected folder, choose a folder scope or configure a custom working folder. **Activity** shows the command, working folder, live stdout/stderr, exit status, and a Stop program control. Runs are kept for the current app session, with the most recent 100,000 characters of output per run. One external command/import chain runs at a time; the window stays open until it finishes.

After a successful command, **Send to Import music** in Activity opens the import page with the newly created music folders, ZIPs and loose tracks already selected. Enable **Open Import music when the program finishes** in Settings to open that page automatically. Review the destination folder, genre tagging and comment cleanup there, then choose **Import program output**. No drag and drop is needed, and no files are moved until you start the import. Routing lives only on the Import music page; the old separate automatic-import destination and tagging fields are no longer used.

Failed or stopped commands skip the handoff. Existing and modified existing files are excluded. Programs must finish writing output before exiting and must write under the working folder for detection. ZIP archives remain intact. New loose tracks and adjacent new sidecars are grouped into an album; unchanged originals are removed after successful import. New album folders already in the chosen destination are held in scratch space while tagging, and their retained path is shown in Activity if import fails. **View imports** opens detailed tagging/moving progress. Remove an individual finished run with its **Remove from activity** control, or use **Clear finished** to clear all completed, failed and stopped runs. Active runs stay visible; clearing activity leaves music files and the import queue untouched. Run `npm run test:external` to check the complete desktop flow using generated test music.

Preview resolution checks Apple search, then the exact album track list, then Deezer, accepting only matching artist and album identities. A same-named track on a compilation is rejected. Saved Deezer clips refresh before playback when expired. AI picks no longer favor preview availability. Dub prompts distinguish roots dub, UK steppers, dub techno, and dubstep from owned albums. The optional **A direction for this dig** field adds listener guidance. In-app YouTube playback is not implemented; an official visible video player would be a separate integration.

The packaged app includes a standalone Python/Mutagen importer; users do not install Python. For development imports use Python 3.12 and Mutagen (default `C:\Python312\python.exe`, overridable with `CRATE_PYTHON`). Before packaging:

```powershell
C:\Python312\python.exe -m venv .importer-venv
.\.importer-venv\Scripts\python.exe -m pip install -r scripts/importer-requirements.txt
npm run dist
```

The installer includes helper sources and third-party licenses. `tests/import_music_test.py` checks real WAV tagging/audio preservation, source hashes, collisions, comment settings, unsupported formats, unsafe ZIP paths, and the standalone executable. `scripts/import-desktop-smoke.mjs` checks native-backed folder and ZIP drops, verified folder relocation, automatic routing/tagging/indexing, and link controls with an isolated profile and test clipboard. Live checks confirmed exact Deezer clips for King Tubby, Mad Professor, and Rhythm & Sound, and an Amazon album URL for Beach House. Tests do not use user music folders.

## Technical choices

Electron + React + TypeScript + Vite. Native SQLite through Node's built-in `node:sqlite`; `music-metadata` for read-only tag extraction. A sandboxed renderer with context isolation, no Node integration, a restrictive Content Security Policy, sender-validated IPC, and allowlisted external links.

[MusicBrainz](https://musicbrainz.org/doc/MusicBrainz_API) provides release groups and discographies without a key. Requests have an app user agent and are queued at least 1.1 seconds apart. Apple searches are spaced at least 3.1 seconds apart. Finds appear first, and artwork and previews fill in progressively; cached matches appear immediately. Switching scope cancels the remaining enrichment for the old queue. [Apple iTunes Search](https://performance-partners.apple.com/search-api) supplies artwork, a representative preview track, and attribution links. Search matches require the same artist and album; absent matches are shown without a playable preview rather than substituting another album.

Catalog browse uses genre/artist-seeded heuristics. AI discovery uses schema-constrained model responses grounded in the selected album corpus, followed by deterministic ownership/rejection filtering and catalog/preview checks. Neither mode uses audio embeddings or collaborative filtering. It can only know what tags and folder names reveal. Album identity is normalized for punctuation, accents, and common bracketed edition suffixes, but unusual aliases or naming conventions can still cause imperfect matching. Artist recommendations exclude owned artist names. Track recommendations conservatively exclude an owned album. There is no full streaming catalog, purchasing, or local-file playback.

## Check and package

```powershell
npm test
npm run test:desktop
npm run test:ai
npm run test:ux
npm run test:imports
npm run test:updates
npm run dist
```

The unit/data tests cover AI context isolation and sampling, grounded response parsing, structured provider requests, caching, stale-request cancellation, album verification and preview fallback, as well as actual WAV tag parsing, read-only file hashes/timestamps, folder fallbacks, incremental scans, deleted files, offline roots, overlapping folders, genre weights, normalization, ownership/rejections, database persistence, fresh and expired cache reuse, progressive enrichment, early shelf saves, and CSV safety. Update tests cover concurrent checks, offline/download retry, explicit installation, busy-work guards, disabled builds, and preference validation. The updater desktop smoke test checks the real IPC bridge, progress and restart controls, compact layout, and persistence. After packaging, `node node_modules/electron/cli.js scripts/update-transport-smoke.mjs` checks the real NSIS updater downloading the installer from an isolated loopback feed and verifying its SHA-512, without launching the installer.

The desktop smoke test launches the real Electron app with isolated test data. It checks onboarding, actual streamed sample playback, Listen mode, shortcuts, undo, themes, layout resizing, native IPC, real folder scanning, native CSV export, persistence across restart, and rejected-item exclusion. External catalog responses and OS file pickers are deterministic fixtures for the native-library portion. Google Gemini request shape, multi-part text parsing, blocked responses, provider key isolation, and its Settings controls are tested with stubbed provider responses. The AI discovery desktop suite verifies the genre corpus sent to the provider, explicit generation, preview-only listening, unverified-release removal, shelf choices, and provider failures without fallback. AI generation responses are simulated in tests; recommendation quality has not been evaluated with your private key. A separate live French-catalog check found matching previews for five representative shoegaze/dream-pop records. It writes screenshots to `artifacts/` and does not access your music folders.

The project has no signing certificate. Build artifacts are unsigned; update downloads use HTTPS and the updater verifies release-file SHA-512 checksums. Audio-based similarity, custom tags, swipe gestures, and accent extraction are future refinements. Folder watching uses filesystem notifications with a periodic scan fallback.

Imports stage outside the watched music destination: app data on the same volume, or a hidden per-volume scratch directory for another drive. Only completed album folders are atomically published into the library, preventing other music players from indexing temporary paths. Existing MusicBee entries that reference staging paths must be relinked to the final album folder.
