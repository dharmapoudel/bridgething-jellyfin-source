import { useEffect, useRef, useState } from 'react';
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

function TransportButtons({
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
  return (
    <div className="flex items-center gap-4">
      <IconBtn size={72} label="Previous" onClick={() => void player.prev()} disabled={!t}>
        <Icon name="prev" size={40} />
      </IconBtn>
      <IconBtn
        size={96}
        label={player.intentPlaying ? 'Pause' : 'Play'}
        active
        onClick={() => void player.toggle()}
        disabled={!t}
      >
        {player.loading ? (
          <span className="h-10 w-10 animate-spin rounded-full border-4 border-black/20 border-t-black" />
        ) : (
          <Icon name={player.intentPlaying ? 'pause' : 'play'} size={52} />
        )}
      </IconBtn>
      <IconBtn size={72} label="Next" onClick={() => void player.next()} disabled={!t}>
        <Icon name="next" size={40} />
      </IconBtn>
      <IconBtn
        size={64}
        label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
        active={isFavorite}
        onClick={onToggleFav}
      >
        <Icon name={isFavorite ? 'heartFill' : 'heart'} size={28} />
      </IconBtn>
      {lyricsSupported !== false ? (
        <IconBtn
          size={64}
          label={lyricsTab ? 'Hide lyrics' : 'Show lyrics'}
          active={lyricsTab}
          onClick={onToggleLyrics}
        >
          <Icon name="mix" size={28} />
        </IconBtn>
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

  const statusLine =
    player.error ? (
      <div className="text-xl text-red-300">{player.error}</div>
    ) : player.external ? (
      <div className="text-xl text-white/50">Another app is playing on the phone.</div>
    ) : null;

  // Info panel: artist, title, album, progress, a few buttons — the split
  // design from the mock, on a deep maroon like its dark variant.
  const infoPanel = (
    <div className="flex min-h-0 flex-col justify-center gap-4 overflow-hidden bg-[#2b1114] px-8">
      <div className="min-w-0">
        <div className="truncate text-xl font-semibold tracking-wide text-white/70">{t.artist}</div>
        <div className="mt-1 line-clamp-4 text-4xl leading-tight font-bold text-white">{t.name}</div>
        {t.album ? <div className="mt-1 truncate text-2xl text-white/50">{t.album}</div> : null}
      </div>
      <ProgressBar onSeek={ms => void player.seekTo(ms)} />
      <TransportButtons
        isFavorite={t.isFavorite}
        onToggleFav={toggleFav}
        lyricsTab={lyricsTab}
        onToggleLyrics={() => setLyricsTab(v => !v)}
        lyricsSupported={lyricsSupported}
      />
      {statusLine}
    </div>
  );

  if (portrait) {
    return (
      <div className="flex h-full flex-col">
        <div className="w-full shrink-0 overflow-hidden" style={{ height: '52%' }}>
          {artPanel}
        </div>
        <div className="min-h-0 flex-1">{infoPanel}</div>
      </div>
    );
  }

  return (
    <div className="flex h-full">
      <div className="h-full w-[42%] shrink-0">{infoPanel}</div>
      <div className="h-full min-w-0 flex-1 overflow-hidden">{artPanel}</div>
    </div>
  );
}
