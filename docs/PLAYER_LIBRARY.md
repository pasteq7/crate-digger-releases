# Player and collection controls

- Click an album, artist, or indexed root folder to expand its tracks directly inside the collection. Folder view starts with the roots you added; it does not scatter their subfolders across the initial grid. Root paths are shown to distinguish folders with the same name. Large panels display 100 tracks per page.
- **Follow playing track** in the toolbar automatically opens the matching group and scrolls to its track, including when it is on a later collection or track page. It follows within the current filters. Turn it off to browse freely. Clicking the current artwork in the player reveals the playing track and clears conflicting search, playlist, and filter scopes.
- Selecting a track, album, artist, folder, or liked selection preserves the shuffle switch. Explicit Shuffle buttons turn shuffle on.
- **Settings → General → Font size** changes text size from 80% to 160% and remembers the preference. Player and drawer space grow with larger text.

## Track metadata

Use the information button on an inline track or the player, or **Edit library details** in a track row menu. View the file location, format, duration, sample rate, bit depth, bitrate, and ReplayGain information. Edit title, artist, album, album artist, genre, year, track/disc numbers, rating, personal tags, and notes.

Edits are stored in Crate Digger and reflected in collection queries and the playing queue. Original audio and file tags remain unchanged.

## APE playback

APE playback uses the official [Monkey's Audio SDK](https://monkeysaudio.com/developers.html), redistributed under its [3-Clause BSD license](https://monkeysaudio.com/license.html). The installer includes the separate native decoder, license, and source/build information.

On first playback, the app decodes the source into a private WAV cache under the user-data directory. Preparing a large file may take a little time; subsequent plays reuse the cache. Seeking uses the decoded audio's byte ranges. Sources are read-only, and a canceled preparation terminates its background process. No user-installed codec, Python, FFmpeg, or network service is used for playback.

The cache budgets 2 GB, excluding active audio, with a 2 GB decoded limit per file. Old inactive entries are removed as space is needed. This does not add CUE-sheet splitting or support for other previously unsupported codecs.
