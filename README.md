# Crate Digger

A local Windows music discovery app built around the music you own.

This repository hosts Windows installers and automatic-update files. Application source code is maintained separately.

## Install

Download the newest `Crate-Digger-Setup-<version>.exe` from [Releases](https://github.com/pasteq7/crate-digger-releases/releases) and run it. Installation is per user. Builds are currently unsigned.

## Updates

Starting with version 0.4.1, installed copies check for stable releases after startup and every six hours. New versions download in the background. Use **Settings > App updates** to check manually or turn background checks off.

Choose **Restart to update** when a download is ready. Finish imports, library scans, and external commands first. Your music and app data remain in their existing locations.

If you use an older build, install 0.4.1 or later once to enable future updates. Development and unpacked builds do not update themselves.

Each published release includes the installer, its `.blockmap`, and `latest.yml`. Draft releases are not offered to installed apps.