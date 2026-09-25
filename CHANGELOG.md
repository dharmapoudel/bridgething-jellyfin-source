## 0.1.28

- Queue bar is more visible (wider, slightly brighter) — the 0.1.27 bar was
  nearly invisible at 15% white. Same behavior: shows on every screen while
  a song is playing, tap/swipe up opens the queue sheet.
- Cold-start caching: Home rails and Library lists are now kept in a
  persistent (localStorage) sticky cache. A cold start paints the last known
  library instantly, then revalidates in the background; tab switches were
  already instant via the in-memory cache.
- Artwork pipeline hardened: all daemon image fetches go through a
  concurrency gate (max 4 in flight, FIFO). Prefetch is capped at 48 items,
  scoped to the current Library tab, and cancelled on tab switch — the old
  code fired one fetch per tile (hundreds at once) when the library loaded,
  which was knocking the Bluetooth link over.
- Landscape nav bar is icons-only now (Home/Library/Queue labels hidden);
  portrait keeps the labels.

## 0.1.27

- The mini now-playing bar is gone. Instead, the small transparent queue
  bar now shows at the bottom of EVERY screen while a song is playing
  (tap or swipe up opens the queue sheet). The queue bar/sheet moved from
  the Now Playing view to the app root so it's always available.

## 0.1.26

- Now Playing reverts to the pre-0.1.25 layout (album art left, info panel
  right) with the right-side controls in the Spotify Car Thing arrangement:
  clock, title/artist, progress bar with elapsed/-remaining times, transport,
  then heart + lyrics icons where the reference puts its volume bar (no
  volume slider). The queue sheet stays: its bottom handle bar is 2/3
  shorter and more transparent, and the sheet now closes by swiping down on
  the grabber (or tapping the backdrop) — the X close button is gone. The
  Glass Overlay ambient-inhibit signal from 0.1.25 is unchanged.

## 0.1.25

- Now Playing redesign: blurred album-art backdrop; the volume bar is gone, replaced by a slim action rail with love (favorite) + lyrics buttons; album art sits left and the lyrics toggle swaps the art panel for tick-by-tick synced lyrics; a slim bottom-center bar (tap or swipe up) opens the queue sheet; the device Clock is removed from the info column and an "UP NEXT" card (tap to open the queue) sits top-right.
- The Now Playing screen now holds the Glass Overlay ambient screensaver off while it's up (requires Glassy Overlay 0.3.27+): it signals the overlay through a `bridgething:ambient-inhibit` DOM event plus a sticky `window.__bridgethingAmbientInhibit` flag, cleared on unmount. This replaces the old synthetic-pointermove keepalive that only covered the lyrics tab.

## 0.1.24

- Removed the "Resume listening" banner from the Home screen.

## 0.1.23

- New app icon: simplified singing-finch head (crest reduced to two subtle feathers) in gold line-art with a fully transparent background — no more navy square, so the hub tile no longer trims it into a squircle. 512x512 RGBA PNG at 34.7KB, under the daemon 64KB cap.

## 0.1.22

- New app icon: the approved singing-finch head — short upward finch beak, bold swept-back crest, music note — in gold line-art on the dark navy background, full-bleed square, 256-color PNG at 17.8KB (well under the daemon 64KB cap).

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
