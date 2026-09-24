# Finch

A Jellyfin music player web app for the bridgething Car Thing.

## What it is

Finch browses your Jellyfin music library (albums, artists, playlists, genres)
and plays it through the phone: the web app is the remote, the phone's stream
provider fetches, decodes and plays the audio. The UI is built for the car:
big touch targets, a full-screen now-playing view, knob volume, preset
shortcuts and an on-screen keyboard for search and setup.

## Features

- Home: continue listening, recently added albums, favorites, playlists, shuffle-everything
- Library tabs: albums, artists, playlists, genres
- Album / artist / playlist / genre detail with track lists
- Search with on-screen keyboard (tracks, albums, artists)
- Now Playing: artwork, seekable progress, shuffle/repeat, favorite, volume, queue, lyrics (if the daemon has any)
- Queue view: jump, remove, clear
- Context menus: play next, add to queue, favorite, instant mix
- Scrobbling via Jellyfin session reporting
- Resume: queue + position persist across restarts
- Settings page (runs on the phone): sign in with username/password or paste an API key
- On-device fallback setup with on-screen keyboard

## Develop

```sh
bun install
bun run typecheck
bun run build     # app + settings page
bun run share     # Finch-<version>.zip for sideloading
```

`bun run dev` serves with hot reload; `bun run push` installs onto a connected Car Thing.

## Notes

- `public/manifest.json` `id` is the app's identity on the device: never change it.
- Version 0.1.0. Sideload only; no store catalog publishing.
