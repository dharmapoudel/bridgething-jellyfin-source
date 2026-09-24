import { useEffect, useRef, useState } from 'react';
import { getClient } from '../client';
import { Icon, IconBtn, ProgressBar, useArt, useCachedArt, usePlayer, usePortrait } from '../components';
import type { JellyfinClient, LyricLineVM } from '../jellyfin';
import { player } from '../player';
import type { ViewProps } from '../nav';

// Lyrics view state. Shape borrowed from Ousa-Music-Player's useLyrics:
// loading / none / timed / plain are all ordinary outcomes, none an error.
type LyricsState =
  | { state: 'loading' }
  | { state: 'none' }
  | { state: 'synced'; lines: LyricLineVM[] }
  | { state: 'plain'; lines: LyricLineVM[] };

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
      lineRefs.current.get(active)?.scrollIntoView({ block: 'center' });
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
              isActive ? 'text-3xl font-bold text-amber-300' : 'text-2xl font-medium text-white/45'
            }`}
          >
            {l.text}
          </button>
        );
      })}
    </div>
  );
}

function LyricsPanel({
  jf,
  trackId,
  durationMs,
}: {
  jf: JellyfinClient;
  trackId: string;
  durationMs: number;
}) {
  const [lyrics, setLyrics] = useState<LyricsState>({ state: 'loading' });

  // Lazily fetched when the tab is first opened, never for the whole queue
  // up front. The stale guard handles the track changing mid-fetch.
  useEffect(() => {
    let stale = false;
    setLyrics({ state: 'loading' });
    jf.getLyrics(trackId, durationMs).then(
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
  }, [jf, trackId, durationMs]);

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
        <Icon name="mix" size={64} className="text-white/20" />
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

function fmtClock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// Device clock for the top of the info panel, like the reference.
function Clock() {
  const [, force] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => force(n => n + 1), 1000);
    return () => window.clearInterval(id);
  }, []);
  const s = new Date().toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  });
  return <div className="text-lg text-white/60">{s}</div>;
}

// Volume slider. The daemon only takes absolute levels via setVolume;
// drags are throttled so a long swipe doesn't flood the phone link.
function VolumeSlider() {
  usePlayer();
  const trackRef = useRef<HTMLDivElement>(null);
  const lastSent = useRef(0);
  const level = player.volume ?? 0;

  const send = (clientX: number, force: boolean): void => {
    const el = trackRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const p = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    const now = Date.now();
    if (!force && now - lastSent.current < 120) return;
    lastSent.current = now;
    player.volume = p; // optimistic; the daemon's VolumeChanged confirms
    player.touch();
    getClient()
      .audio.setVolume({ level: p })
      .catch(() => {});
  };

  return (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <Icon name="volDown" size={28} className="shrink-0 text-white/50" />
      <div
        ref={trackRef}
        role="slider"
        aria-label="Volume"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(level * 100)}
        className="relative h-10 min-w-0 flex-1 cursor-pointer touch-none"
        onPointerDown={e => {
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          send(e.clientX, true);
        }}
        onPointerMove={e => {
          if (e.buttons > 0) send(e.clientX, false);
        }}
        onPointerUp={e => send(e.clientX, true)}
      >
        <div className="absolute top-1/2 right-0 left-0 h-1.5 -translate-y-1/2 rounded-full bg-white/20" />
        <div
          className="absolute top-1/2 left-0 h-1.5 -translate-y-1/2 rounded-full bg-amber-400"
          style={{ width: `${level * 100}%` }}
        />
        <div
          className="absolute top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow"
          style={{ left: `${level * 100}%` }}
        />
      </div>
      <Icon name="volUp" size={28} className="shrink-0 text-white/50" />
    </div>
  );
}

// Right-hand info column: clock, title/artist, progress with times,
// transport, volume — the Spotify Car Thing arrangement from the mock.
function InfoPanel({
  isFavorite,
  onToggleFav,
  lyricsTab,
  onToggleLyrics,
  lyricsSupported,
}: {
  isFavorite: boolean;
  onToggleFav: () => void;
  lyricsTab: boolean;
  onToggleLyrics: () => void;
  lyricsSupported: boolean | null;
}) {
  usePlayer();
  const t = player.current();

  // Tick the time labels while playing; the bar itself animates on rAF.
  const [, tick] = useState(0);
  useEffect(() => {
    if (!player.intentPlaying) return;
    const id = window.setInterval(() => tick(n => n + 1), 500);
    return () => window.clearInterval(id);
  }, [player.intentPlaying]);

  if (!t) return null;
  const dur = player.trackDurationMs;
  const pos = player.positionNow();

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#14161c] px-6 py-4">
      <div className="flex shrink-0 items-center justify-between">
        <Clock />
        <div className="flex items-center">
          <IconBtn
            size={52}
            label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
            active={isFavorite}
            onClick={onToggleFav}
          >
            <Icon name={isFavorite ? 'heartFill' : 'heart'} size={24} />
          </IconBtn>
          {lyricsSupported !== false ? (
            <IconBtn
              size={52}
              label={lyricsTab ? 'Hide lyrics' : 'Show lyrics'}
              active={lyricsTab}
              onClick={onToggleLyrics}
            >
              <Icon name="mix" size={24} />
            </IconBtn>
          ) : null}
        </div>
      </div>

      <div className="mt-1 min-w-0 shrink-0">
        <div className="truncate text-3xl font-bold text-white">{t.name}</div>
        <div className="mt-0.5 truncate text-2xl text-white/60">{t.artist}</div>
      </div>

      <div className="mt-3 shrink-0">
        <ProgressBar onSeek={ms => void player.seekTo(ms)} />
        <div className="-mt-1 flex items-center justify-between text-lg text-white/50">
          <span>{fmtClock(pos)}</span>
          <span>-{fmtClock(Math.max(0, dur - pos))}</span>
        </div>
      </div>

      <div className="mt-1 flex shrink-0 items-center justify-center gap-6">
        <IconBtn size={64} label="Previous" onClick={() => void player.prev()}>
          <Icon name="prev" size={36} />
        </IconBtn>
        <IconBtn
          size={88}
          label={player.intentPlaying ? 'Pause' : 'Play'}
          active
          onClick={() => void player.toggle()}
        >
          {player.loading ? (
            <span className="h-9 w-9 animate-spin rounded-full border-4 border-black/20 border-t-black" />
          ) : (
            <Icon name={player.intentPlaying ? 'pause' : 'play'} size={44} />
          )}
        </IconBtn>
        <IconBtn size={64} label="Next" onClick={() => void player.next()}>
          <Icon name="next" size={36} />
        </IconBtn>
      </div>

      <div className="mt-auto flex shrink-0 items-center pt-2">
        <VolumeSlider />
      </div>

      {player.error ? (
        <div className="shrink-0 pt-1 text-xl text-red-300">{player.error}</div>
      ) : player.external ? (
        <div className="shrink-0 pt-1 text-xl text-white/50">Another app is playing on the phone.</div>
      ) : null}
    </div>
  );
}

export default function NowPlaying({ jf, nav }: ViewProps) {
  usePlayer();
  const art = useArt();
  const portrait = usePortrait();
  const [lyricsTab, setLyricsTab] = useState(false);
  const [lyricsSupported, setLyricsSupported] = useState<boolean | null>(null);
  const t = player.current();
  const trackId = t?.id;

  // Full-bleed artwork for the hero panel, served from the shared blob cache.
  const { url: heroArt } = useCachedArt(t ? (art?.trackArt(t, 800) ?? null) : null);

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
          className="h-18 rounded-full bg-amber-400 px-8 text-2xl font-bold text-black active:bg-amber-300"
        >
          Browse your library
        </button>
      </div>
    );
  }

  const artPanel = lyricsTab ? (
    <LyricsPanel jf={jf} trackId={t.id} durationMs={t.durationMs} />
  ) : heroArt ? (
    <img
      src={heroArt}
      alt={t.album || t.name}
      draggable={false}
      className="h-full w-full object-cover"
    />
  ) : (
    <div className="flex h-full w-full items-center justify-center bg-zinc-900">
      <Icon name="note" size={96} className="text-white/15" />
    </div>
  );

  const infoPanel = (
    <InfoPanel
      isFavorite={t.isFavorite}
      onToggleFav={toggleFav}
      lyricsTab={lyricsTab}
      onToggleLyrics={() => setLyricsTab(v => !v)}
      lyricsSupported={lyricsSupported}
    />
  );

  if (portrait) {
    return (
      <div className="flex h-full flex-col">
        <div className="w-full shrink-0 overflow-hidden" style={{ height: '48%' }}>
          {artPanel}
        </div>
        <div className="min-h-0 flex-1">{infoPanel}</div>
      </div>
    );
  }

  return (
    <div className="flex h-full">
      <div className="h-full w-[55%] shrink-0 overflow-hidden">{artPanel}</div>
      <div className="h-full min-w-0 flex-1">{infoPanel}</div>
    </div>
  );
}
