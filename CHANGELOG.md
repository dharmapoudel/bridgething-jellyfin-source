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
