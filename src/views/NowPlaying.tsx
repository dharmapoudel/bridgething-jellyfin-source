import { useEffect, useRef, useState, type TouchEvent as RTouchEvent } from 'react';
import { Artwork, Icon, IconBtn, ProgressBar, useArt, useCachedArt, usePlayer, usePortrait } from '../components';
import type { LyricLineVM } from '../jellyfin';
import { player } from '../player';
import type { ViewProps } from '../nav';

// Lyrics view state. Shape borrowed from Ousa-Music-Player's useLyrics:
// loading / none / timed / plain are all ordinary outcomes, none an error.
type LyricsState =
  | { state: 'loading' }
  | { state: 'none' }
  | { state: 'synced'; lines: LyricLineVM[] }
  | { state: 'plain'; lines: LyricLineVM[] };

// Signal the Glass Overlay (injected into this same document) to hold its
// ambient screensaver off while the Now Playing screen is up. The overlay
// raises the ambient screen after N seconds with no input events, but here
// the user is watching, not touching. Sticky window flag first (the overlay
// may boot after this view mounts), then the DOM event for changes; both
// are cleared on unmount so the screensaver can return afterwards.
const AMBIENT_INHIBIT_EVENT = 'bridgething:ambient-inhibit';
const AMBIENT_INHIBIT_FLAG = '__bridgethingAmbientInhibit';

function setAmbientInhibit(inhibit: boolean): void {
  try {
    (window as unknown as Record<string, unknown>)[AMBIENT_INHIBIT_FLAG] = inhibit;
  } catch {
    /* a locked-down window object shouldn't break playback */
  }
  window.dispatchEvent(new CustomEvent(AMBIENT_INHIBIT_EVENT, { detail: { inhibit } }));
}

// The line that should be lit right now: the last one that has started.
// Binary search, since a synced track can carry hundreds of lines.
function activeLineIndex(lines: LyricLineVM[], posMs: number): number {
  let lo = 0;
  let hi = lines.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].startMs <= posMs) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

function SyncedLyrics({ lines }: { lines: LyricLineVM[] }) {
  usePlayer();
  const [, force] = useState(0);
  const lineRefs = useRef(new Map<number, HTMLButtonElement>());
  const lastActive = useRef(-2);

  // Re-evaluate the active line a few times a second while playing. The
  // player extrapolates position locally between daemon snapshots, so
  // positionNow() stays fresh without any snapshot traffic.
  useEffect(() => {
    if (!player.intentPlaying) return;
    const id = window.setInterval(() => force(n => n + 1), 250);
    return () => window.clearInterval(id);
  }, [player.intentPlaying]);

  const active = activeLineIndex(lines, player.positionNow());

  useEffect(() => {
    if (active !== lastActive.current && active >= 0) {
      lastActive.current = active;
      // Smooth-glide to the new line; the old instant jump is what made
      // the lyrics feel out of sync with the audio.
      lineRefs.current.get(active)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  });

  return (
    <div className="h-full w-full overflow-y-auto px-6 py-8">
      {lines.map((l, i) => {
        const isActive = i === active;
        return (
          <button
            key={i}
            type="button"
            ref={el => {
              if (el) lineRefs.current.set(i, el);
              else lineRefs.current.delete(i);
            }}
            onClick={() => void player.seekTo(l.startMs)}
            className={`block w-full rounded-2xl px-4 py-3 text-center transition-colors active:bg-white/10 ${
              isActive ? 'text-3xl font-bold text-goldlight' : 'text-2xl font-medium text-white/45'
            }`}
          >
            {l.text}
          </button>
        );
      })}
    </div>
  );
}

// Pure renderer — the lyrics for the current track are fetched once in
// NowPlaying (per-track cached in the client), so the toggle can dim when
// the track has none and the tab opens instantly.
function LyricsPanel({ lyrics }: { lyrics: LyricsState }) {
  if (lyrics.state === 'loading') {
    return (
      <div className="flex h-full w-full items-center justify-center text-2xl text-white/50">
        Loading lyrics…
      </div>
    );
  }
  if (lyrics.state === 'none') {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-8 text-center">
        <Icon name="note" size={64} className="text-white/20" />
        <div className="text-2xl font-semibold text-white/70">No lyrics for this track</div>
        <div className="text-lg leading-snug text-white/40">
          Jellyfin shows lyrics embedded in the file's tags — rescan the library after tagging.
        </div>
      </div>
    );
  }
  if (lyrics.state === 'plain') {
    return (
      <div className="h-full w-full overflow-y-auto px-8 py-6">
        <div className="text-center text-2xl leading-relaxed whitespace-pre-line text-white/85">
          {lyrics.lines.map(l => l.text).join('\n')}
        </div>
      </div>
    );
  }
  return <SyncedLyrics lines={lyrics.lines} />;
}

// Full-screen backdrop: the current album art, heavily blurred and dimmed,
// so the whole screen takes on the track's colors like the reference.
function BlurredBackdrop({ url }: { url: string | null }) {
  return (
    <div className="absolute inset-0 overflow-hidden bg-[#14161c]">
      {url ? (
        <img
          src={url}
          alt=""
          aria-hidden="true"
          draggable={false}
          className="absolute inset-0 h-full w-full scale-150 object-cover blur-3xl brightness-[0.4]"
        />
      ) : null}
      <div className="absolute inset-0 bg-black/30" />
    </div>
  );
}

function Transport() {
  usePlayer();
  return (
    <div className="flex items-center justify-center gap-8">
      <IconBtn size={72} label="Previous" onClick={() => void player.prev()}>
        <Icon name="prev" size={40} />
      </IconBtn>
      <IconBtn
        size={96}
        label={player.intentPlaying ? 'Pause' : 'Play'}
        active
        onClick={() => void player.toggle()}
      >
        {player.loading ? (
          <span className="h-10 w-10 animate-spin rounded-full border-4 border-black/20 border-t-black" />
        ) : (
          <Icon name={player.intentPlaying ? 'pause' : 'play'} size={48} />
        )}
      </IconBtn>
      <IconBtn size={72} label="Next" onClick={() => void player.next()}>
        <Icon name="next" size={40} />
      </IconBtn>
    </div>
  );
}

// Top-right "Up next" preview card, like the reference. Tapping opens the
// queue sheet.
function UpNextCard({ onOpen }: { onOpen: () => void }) {
  usePlayer();
  const art = useArt();
  const next = player.queue[player.index + 1];
  if (!next) return <div className="h-[80px] shrink-0" />;
  return (
    <div className="flex h-[80px] shrink-0 items-start justify-end">
      <button
        type="button"
        onClick={onOpen}
        className="flex max-w-full items-center gap-3 rounded-2xl bg-white/10 py-2 pl-2 pr-4 backdrop-blur-sm active:bg-white/20"
      >
        <Artwork src={art?.trackArt(next, 200) ?? null} size={60} rounded="rounded-xl" label={next.album} />
        <span className="min-w-0 text-left">
          <span className="block text-sm font-bold tracking-[0.2em] text-white/50 uppercase">Up next</span>
          <span className="block max-w-64 truncate text-xl leading-tight font-semibold">{next.name}</span>
          <span className="block max-w-64 truncate text-base leading-tight text-white/55">{next.artist}</span>
        </span>
      </button>
    </div>
  );
}

type RailProps = {
  isFavorite: boolean;
  onToggleFav: () => void;
  lyricsTab: boolean;
  onToggleLyrics: () => void;
  lyricsSupported: boolean | null;
  hasLyrics: boolean;
  vertical: boolean;
};

// Love + lyrics actions. Vertical on the right edge in landscape (where the
// reference puts its volume strip), horizontal under the transport in
// portrait.
function ActionRail({
  isFavorite,
  onToggleFav,
  lyricsTab,
  onToggleLyrics,
  lyricsSupported,
  hasLyrics,
  vertical,
}: RailProps) {
  return (
    <div
      className={
        vertical
          ? 'flex w-24 shrink-0 flex-col items-center justify-center gap-10'
          : 'flex shrink-0 items-center justify-center gap-10'
      }
    >
      <IconBtn
        size={60}
        label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
        active={isFavorite}
        onClick={onToggleFav}
      >
        <Icon name={isFavorite ? 'heartFill' : 'heart'} size={30} />
      </IconBtn>
      {lyricsSupported !== false ? (
        <IconBtn
          size={60}
          label={hasLyrics ? (lyricsTab ? 'Hide lyrics' : 'Show lyrics') : 'No lyrics for this track'}
          active={lyricsTab}
          disabled={!hasLyrics}
          onClick={onToggleLyrics}
        >
          <Icon name="note" size={30} />
        </IconBtn>
      ) : null}
    </div>
  );
}

// The almost-transparent bar at the middle bottom. Swipe up (or tap) opens
// the queue sheet.
function QueueHandle({ onOpen }: { onOpen: () => void }) {
  const startY = useRef<number | null>(null);
  return (
    <button
      type="button"
      aria-label="Open queue"
      onClick={onOpen}
      onTouchStart={e => {
        startY.current = e.touches[0].clientY;
      }}
      onTouchEnd={e => {
        const s = startY.current;
        startY.current = null;
        if (s !== null && s - e.changedTouches[0].clientY > 50) onOpen();
      }}
      className="absolute bottom-1 left-1/2 z-20 -translate-x-1/2 p-3"
    >
      <div className="h-1.5 w-36 rounded-full bg-white/25" />
    </button>
  );
}

// Queue as a bottom sheet over Now Playing. Swipe down on the grabber, tap
// the backdrop, or hit X to close. Touches are contained so the root's
// minimize gesture never fires from inside the sheet.
function QueueSheet({ onClose }: { onClose: () => void }) {
  usePlayer();
  const art = useArt();
  const upcoming = player.queue.slice(player.index + 1);
  const current = player.current();
  const grab = useRef<{ y: number } | null>(null);

  return (
    <div
      className="absolute inset-0 z-30"
      onTouchStart={e => e.stopPropagation()}
      onTouchEnd={e => e.stopPropagation()}
    >
      <button type="button" aria-label="Close queue" onClick={onClose} className="absolute inset-0 bg-black/50" />
      <div className="absolute inset-x-0 bottom-0 top-[10%] flex flex-col overflow-hidden rounded-t-3xl bg-[#171a21]/95 shadow-2xl backdrop-blur-xl">
        <div
          className="shrink-0 px-6 pt-3 pb-1"
          onTouchStart={e => {
            grab.current = { y: e.touches[0].clientY };
          }}
          onTouchEnd={e => {
            const g = grab.current;
            grab.current = null;
            if (g && e.changedTouches[0].clientY - g.y > 60) onClose();
          }}
        >
          <div className="mx-auto h-1.5 w-16 rounded-full bg-white/30" />
        </div>
        <div className="flex shrink-0 items-center justify-between px-6 py-2">
          <h2 className="text-2xl font-bold">Up next{upcoming.length ? ` (${upcoming.length})` : ''}</h2>
          <div className="flex items-center gap-3">
            {upcoming.length ? (
              <button
                type="button"
                onClick={() => player.clearQueue()}
                className="h-12 rounded-full bg-white/10 px-5 text-lg text-red-300 active:bg-white/20"
              >
                Clear
              </button>
            ) : null}
            <IconBtn size={52} label="Close queue" onClick={onClose}>
              <Icon name="x" size={26} />
            </IconBtn>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
          {current ? (
            <div className="mb-2 flex items-center gap-3 rounded-2xl bg-leaf/10 p-2">
              <Artwork src={art?.trackArt(current, 200) ?? null} size={56} rounded="rounded-lg" label={current.album} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-xl font-medium text-leaf">{current.name}</div>
                <div className="truncate text-base text-white/50">Now playing · {current.artist}</div>
              </div>
              <IconBtn size={56} label={player.intentPlaying ? 'Pause' : 'Play'} onClick={() => void player.toggle()}>
                <Icon name={player.intentPlaying ? 'pause' : 'play'} size={28} />
              </IconBtn>
            </div>
          ) : null}
          {upcoming.length === 0 ? (
            <div className="flex items-center justify-center px-8 py-10 text-center text-xl text-white/40">
              {current ? 'The queue ends here.' : 'The queue is empty. Play something from your library.'}
            </div>
          ) : (
            upcoming.map((t, i) => {
              const qi = player.index + 1 + i;
              return (
                <div
                  key={`${t.id}-${qi}`}
                  className="flex min-h-16 items-center gap-3 rounded-xl px-2 py-1.5 active:bg-white/8"
                >
                  <button
                    type="button"
                    onClick={() => void player.jumpTo(qi)}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  >
                    <Artwork src={art?.trackArt(t, 200) ?? null} size={52} rounded="rounded-lg" label={t.album} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xl leading-tight">{t.name}</span>
                      <span className="block truncate text-base leading-tight text-white/50">{t.artist}</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove ${t.name} from queue`}
                    onClick={() => player.removeAt(qi)}
                    className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-white/50 active:bg-white/15"
                  >
                    <Icon name="x" size={26} />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

export default function NowPlaying({ jf, nav, onMinimize }: ViewProps & { onMinimize: () => void }) {
  usePlayer();
  const art = useArt();
  const portrait = usePortrait();
  const [lyricsTab, setLyricsTab] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [lyricsSupported, setLyricsSupported] = useState<boolean | null>(null);
  const [lyrics, setLyrics] = useState<LyricsState>({ state: 'loading' });
  const t = player.current();
  const trackId = t?.id;
  const artPanelRef = useRef<HTMLDivElement>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  // While this view is mounted the Now Playing screen is up: hold the Glass
  // Overlay's ambient screensaver off (see setAmbientInhibit above) until we
  // unmount. This replaces the old synthetic-pointermove keepalive that only
  // covered the lyrics tab.
  useEffect(() => {
    setAmbientInhibit(true);
    const onHide = (): void => setAmbientInhibit(false);
    window.addEventListener('pagehide', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      setAmbientInhibit(false);
    };
  }, []);

  // A swipe down starting near the top edge minimizes back to the mini
  // player. Touches inside the lyrics panel are left alone so the lyrics
  // keep scrolling instead of minimizing. Disabled while the queue sheet
  // is open — the sheet owns its own gestures.
  const onTouchStart = (e: RTouchEvent): void => {
    const p = e.touches[0];
    touchStart.current = { x: p.clientX, y: p.clientY };
  };
  const onTouchEnd = (e: RTouchEvent): void => {
    if (queueOpen) return;
    const s = touchStart.current;
    touchStart.current = null;
    if (!s) return;
    const p = e.changedTouches[0];
    const dy = p.clientY - s.y;
    const dx = p.clientX - s.x;
    if (lyricsTab && artPanelRef.current?.contains(e.target as Node)) return;
    if (s.y < window.innerHeight * 0.3 && dy > 70 && Math.abs(dx) < 60) {
      onMinimize();
    }
  };

  // Full-bleed artwork for the hero panel, served from the shared blob cache.
  // A small copy doubles as the blurred full-screen backdrop (cheap to blur).
  const { url: heroArt } = useCachedArt(t ? (art?.trackArt(t, 800) ?? null) : null);
  const { url: bgArt } = useCachedArt(t ? (art?.trackArt(t, 200) ?? null) : null);

  // Lyrics need server >= 10.9; hide the toggle entirely on older servers.
  useEffect(() => {
    let stale = false;
    jf.lyricsSupported().then(ok => {
      if (!stale) setLyricsSupported(ok);
    });
    return () => {
      stale = true;
    };
  }, [jf]);

  // Fetch the current track's lyrics as soon as the track changes (one
  // request per track, cached in the client) so the toggle can dim when
  // the track has none and the lyrics tab opens instantly.
  useEffect(() => {
    if (!trackId || lyricsSupported === false) {
      setLyrics({ state: 'none' });
      return;
    }
    let stale = false;
    setLyrics({ state: 'loading' });
    jf.getLyrics(trackId, t?.durationMs ?? 0).then(
      p => {
        if (stale) return;
        if (!p || !p.lines.length) setLyrics({ state: 'none' });
        else if (p.isSynced) setLyrics({ state: 'synced', lines: p.lines });
        else setLyrics({ state: 'plain', lines: p.lines });
      },
      () => {
        if (!stale) setLyrics({ state: 'none' });
      },
    );
    return () => {
      stale = true;
    };
  }, [jf, trackId, lyricsSupported]);

  // A new track gets a fresh lyrics tab; the panel fetches lazily on open.
  useEffect(() => {
    setLyricsTab(false);
  }, [trackId]);

  const toggleFav = (): void => {
    if (!t) return;
    const want = !t.isFavorite;
    t.isFavorite = want;
    player.touch();
    jf.toggleFavorite(t.id, want).catch(() => {
      t.isFavorite = !want;
      player.touch();
    });
  };

  if (!t) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-6 px-8 text-center">
        <Icon name="note" size={96} className="text-white/20" />
        <div className="text-3xl font-semibold text-white/70">Nothing playing</div>
        <button
          type="button"
          onClick={() => nav({ name: 'home' })}
          className="h-18 rounded-full bg-leaf px-8 text-2xl font-bold text-black active:brightness-90"
        >
          Browse your library
        </button>
      </div>
    );
  }

  const hasLyrics = lyrics.state === 'synced' || lyrics.state === 'plain';
  const railProps = {
    isFavorite: t.isFavorite,
    onToggleFav: toggleFav,
    lyricsTab,
    onToggleLyrics: () => setLyricsTab(v => !v),
    lyricsSupported,
    hasLyrics,
  };

  // The lyrics toggle swaps the art card for the tick-by-tick lyrics,
  // keeping the same panel and backdrop.
  const artPanel = lyricsTab ? (
    <div className="relative h-full w-full overflow-hidden rounded-3xl bg-black/25">
      <div className="relative h-full w-full">
        <LyricsPanel lyrics={lyrics} />
      </div>
    </div>
  ) : heroArt ? (
    <img
      src={heroArt}
      alt={t.album || t.name}
      draggable={false}
      className="h-full w-full rounded-3xl object-cover shadow-2xl"
    />
  ) : (
    <div className="flex h-full w-full items-center justify-center rounded-3xl bg-white/8">
      <Icon name="note" size={96} className="text-white/15" />
    </div>
  );

  const errorBlock =
    player.error ? (
      <div className="shrink-0 pt-2 text-xl text-red-300">{player.error}</div>
    ) : player.external ? (
      <div className="shrink-0 pt-2 text-xl text-white/50">Another app is playing on the phone.</div>
    ) : null;

  const openQueue = (): void => setQueueOpen(true);
  const closeQueue = (): void => setQueueOpen(false);

  if (portrait) {
    return (
      <div className="relative flex h-full flex-col" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <BlurredBackdrop url={bgArt} />
        <div ref={artPanelRef} className="relative w-full shrink-0 p-5" style={{ height: '42%' }}>
          {artPanel}
        </div>
        <div className="relative flex min-h-0 flex-1 flex-col px-6 pb-10">
          <div className="min-w-0 shrink-0">
            <div className="truncate text-3xl font-bold text-white">{t.name}</div>
            <div className="mt-0.5 truncate text-2xl text-white/60">{t.artist}</div>
          </div>
          <div className="mt-3 shrink-0">
            <ProgressBar onSeek={ms => void player.seekTo(ms)} />
          </div>
          <div className="mt-3 shrink-0">
            <Transport />
          </div>
          <div className="mt-4 shrink-0">
            <ActionRail {...railProps} vertical={false} />
          </div>
          {errorBlock}
        </div>
        <QueueHandle onOpen={openQueue} />
        {queueOpen ? <QueueSheet onClose={closeQueue} /> : null}
      </div>
    );
  }

  return (
    <div className="relative flex h-full" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <BlurredBackdrop url={bgArt} />
      <div ref={artPanelRef} className="relative h-full w-[44%] shrink-0 p-6">
        {artPanel}
      </div>
      <div className="relative flex h-full min-w-0 flex-1 flex-col px-6 pt-4 pb-10">
        <UpNextCard onOpen={openQueue} />
        <div className="flex min-h-0 flex-1 flex-col justify-center">
          <div className="min-w-0">
            <div className="truncate text-4xl font-bold text-white">{t.name}</div>
            <div className="mt-1 truncate text-2xl text-white/60">{t.artist}</div>
          </div>
          <div className="mt-5 shrink-0">
            <ProgressBar onSeek={ms => void player.seekTo(ms)} />
          </div>
          <div className="mt-4 shrink-0">
            <Transport />
          </div>
        </div>
        {errorBlock}
      </div>
      <div className="relative flex shrink-0 items-center">
        <ActionRail {...railProps} vertical />
      </div>
      <QueueHandle onOpen={openQueue} />
      {queueOpen ? <QueueSheet onClose={closeQueue} /> : null}
    </div>
  );
}
