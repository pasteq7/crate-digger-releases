# Importing likes from MusicBee or foobar2000

1. Add your existing music folder to Crate Digger. Audio files are indexed read-only.
2. In your other player, make a playlist containing the tracks you consider liked or loved, then export/save it as **UTF-8 M3U8**. Use paths to the same files indexed in Crate Digger. Relative paths are resolved beside the exported playlist; absolute paths and local file URLs are supported.
3. Open **Settings → Library → Liked tracks → Import liked tracks**. Choose the export and review the matching tracks and unresolved paths. Nothing changes during review.
4. Choose **Import likes** to mark the matching tracks liked. Existing likes, ratings, notes, and playlists are preserved. Duplicate playlist entries are counted once. No audio files or source playlists are changed.

MusicBee supports M3U8 playlist export through the playlist’s export action. Its playlist settings also offer an automatically exported static copy, useful when keeping a remembered export current. See the MusicBee forum’s [M3U8 export guidance](https://getmusicbee.com/forum/index.php?topic=35472.0) and [automatically exported playlists discussion](https://getmusicbee.com/forum/index.php?topic=41489.0).

In foobar2000, collect your favorite tracks into a playlist using your chosen love tag or rating convention, then save it as M3U8. Ratings stored by Playback Statistics are not automatically readable as audio tags; that component maintains its own data and supports separate export operations. See the [official Playback Statistics component](https://www.foobar2000.org/components/view/foo_playcount). This importer uses the tracks in the exported playlist and does not read or modify either player’s private database.

## Refreshing an export

Leave **Remember this export for manual refresh** selected during import. After updating the export in your other player, return to **Settings → Library → Remembered exports**, choose **Refresh export**, and review/import again.

Refresh is manual and additive. Removing a track from an export does not remove a like in Crate Digger. Forgetting an export removes the remembered path and keeps imported likes. An unavailable or moved export reports an error; choose its new location with **Import liked tracks**.

## Playing only liked tracks

Use the **heart in the Library toolbar** to show only liked tracks, then Play or Shuffle. Add **genre, artist, year, or minimum-rating filters** to narrow the selection. Play and Shuffle use every matching track, including later pages.

Open an album in the collection grid to view its inline tracklist. Use **Play liked** for that album’s liked tracks. In Artists or Folders views, open a group and use the heart to play only its liked tracks. Favorites also work within playlists.

If an export has no matches, add the missing music folder or export paths pointing to the indexed files on this computer. Files from a different drive layout are reported as unresolved instead of being guessed from titles.
