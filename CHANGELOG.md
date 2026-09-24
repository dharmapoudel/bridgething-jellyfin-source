## 0.1.21

- Buttons are now green instead of gold: play/pause, the active library pill, all CTA buttons and the connect button use the green accent (pressed state darkens). The progress bar and knob stay gold so the theme keeps both colors.

## 0.1.20

- Theme is now golden + green instead of yellow: rich gold (#d2a02e) for controls, progress, selections and the active lyric line; green (#34d399) for "alive" states — the bottom-nav active tab, now-playing highlights in the queue and track rows, the Home now-playing strip, and the mini-player progress ring.

## 0.1.19

- The Library screen no longer has the "Library" top bar with the back arrow — the Albums / Artists / Playlists / Genres row now sits at the top (the bottom tabs already handle navigation).

## 0.1.18

- App icon is now a close-up of the singing finch's head — the full-body bird was too small to read at tile size. (Re-encoded under the daemon's 64KB icon cap.)

## 0.1.17

- The seekbar now matches the reference: slimmer track and knob, elapsed on the left and remaining (-m:ss) on the right.
- The lyrics button is a simple notes icon; it dims and disables when the current track has no lyrics (lyrics are fetched when the track changes, cached per track).
- Removed the duplicate time labels under the seekbar (the progress bar's own row was doubled by the info panel's).
- Lyrics scrolling is now smooth instead of jumping line to line, so the highlight feels in sync with the audio.
- The lyrics view now shows the album art blurred and darkened behind the lyrics.
- The mini player shows a circular progress ring around the play/pause icon.

## 0.1.16

- Removed the volume slider from the Now Playing screen (the knob handles volume).
- Swiping down from the top edge of the Now Playing screen now minimizes it back to the mini player, returning to whichever tab was open before (Escape does the same).
- The lyrics toggle is now a microphone icon, and both the favorite and lyrics buttons moved to a bottom row under the transport controls.
- Fixed tofu blocks in lyrics: Noto Sans Devanagari is now bundled with the app so Devanagari-script lyrics, titles, and artists render on the device.
- While the lyrics view is open, Finch emits a quiet synthetic pointermove every 8 seconds so the Glass Overlay's idle timer never fires its ambient screen over the lyrics.

## 0.1.15

- Redesigned the Now Playing screen after the Spotify Car Thing reference: album art on the left (~55%), dark info panel on the right with the device clock, track title/artist, progress bar with elapsed/remaining times, centered prev/play/next transport, and a volume slider at the bottom (absolute levels via the daemon's setVolume; knob nudges still work and the slider follows). Favorite and lyrics toggles moved to the top-right corner; lyrics still swap the art panel. Portrait stacks art over the info panel.

## 0.1.13

- Removed the Playing tab from the bottom navigation (3 tabs now: Home, Library, Queue); Now Playing opens by tapping the mini player, same as before.
- Redesigned the Now Playing screen after the mock: split layout with artist/title/album, progress bar with times, and transport buttons on a deep maroon panel; album art fills the other side edge-to-edge. Portrait stacks art on top, info below. Kept the favorite and lyrics toggles; dropped the volume/shuffle/repeat/queue buttons from this screen (knob handles volume, Queue tab handles the queue).
- Removed the "Finch" top bar from the Home screen, freeing ~80px of vertical space.
