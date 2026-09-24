import { useEffect, useRef, useState } from 'react';
import { getClient } from '../client';
import { Artwork, Icon, IconBtn, ProgressBar, useArt, usePlayer, usePortrait } from '../components';
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

function Controls({ big = false }: { big?: boolean }) {
  usePlayer();
  const t = player.current();
  const main = big ? 96 : 80;
  return (
    <div className="flex items-center justify-center gap-3">
      <IconBtn
        size={big ? 72 : 64}
        label={player.shuffle ? 'Shuffle on' : 'Shuffle off'}
        active={player.shuffle}
        onClick={() => player.setShuffle(!player.shuffle)}
      >
        <Icon name="shuffle" size={30} />
      </IconBtn>
      <IconBtn size={big ? 80 : 72} label="Previous" onClick={() => void player.prev()} disabled={!t}>
        <Icon name="prev" size={big ? 44 : 38} />
      </IconBtn>
      <IconBtn
        size={main}
        label={player.intentPlaying ? 'Pause' : 'Play'}
        active
        onClick={() => void player.toggle()}
        disabled={!t}
      >
        {player.loading ? (
          <span className="h-10 w-10 animate-spin rounded-full border-4 border-black/20 border-t-black" />
        ) : (
          <Icon name={player.intentPlaying ? 'pause' : 'play'} size={big ? 52 : 44} />
        )}
      </IconBtn>
      <IconBtn size={big ? 80 : 72} label="Next" onClick={() => void player.next()} disabled={!t}>
        <Icon name="next" size={big ? 44 : 38} />
      </IconBtn>
      <IconBtn
        size={big ? 72 : 64}
        label={`Repeat ${player.repeat}`}
        active={player.repeat !== 'off'}
        onClick={() => player.cycleRepeat()}
      >
        <Icon name={player.repeat === 'one' ? 'repeatOne' : 'repeat'} size={30} />
      </IconBtn>
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

  // Lyrics need server >= 10.9; hide the tab entirely on older servers.
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

  const nudge = (dir: 1 | -1): void => {
    const c = getClient();
    if (dir > 0) c.audio.volumeUp().catch(() => {});
    else c.audio.volumeDown().catch(() => {});
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

  const upcoming = player.queue.length - player.index - 1;

  const artBlock = (
    <div className="flex items-center justify-center">
      <Artwork
        src={art?.trackArt(t, 800) ?? null}
        size={portrait ? 380 : 400}
        rounded="rounded-2xl"
        label={t.album}
      />
    </div>
  );

  // The lyrics tab takes over the artwork's footprint (top panel in
  // portrait, left panel in landscape).
  const heroBlock = lyricsTab ? (
    <LyricsPanel jf={jf} trackId={t.id} durationMs={t.durationMs} />
  ) : (
    artBlock
  );

  const infoBlock = (
    <div className="flex min-h-0 w-full flex-col justify-center gap-3 px-6">
      <div className="min-w-0 text-center">
        <div className="truncate text-4xl font-bold">{t.name}</div>
        <div className="truncate text-2xl text-white/60">{t.artist}</div>
        {t.album ? <div className="truncate text-xl text-white/40">{t.album}</div> : null}
      </div>
      {player.error ? (
        <div className="rounded-2xl bg-red-500/15 px-4 py-3 text-center text-xl text-red-300">{player.error}</div>
      ) : player.external ? (
        <div className="rounded-2xl bg-white/8 px-4 py-3 text-center text-xl text-white/60">
          Another app is playing on the phone.
        </div>
      ) : null}
      <ProgressBar onSeek={ms => void player.seekTo(ms)} />
      <Controls big={!portrait} />
      <div className="flex items-center justify-center gap-3">
        <IconBtn size={64} label={t.isFavorite ? 'Remove from favorites' : 'Add to favorites'} active={t.isFavorite} onClick={toggleFav}>
          <Icon name={t.isFavorite ? 'heartFill' : 'heart'} size={30} />
        </IconBtn>
        <IconBtn size={64} label="Volume down" onClick={() => nudge(-1)}>
          <Icon name="volDown" size={30} />
        </IconBtn>
        <IconBtn
          size={64}
          label={player.muted ? 'Unmute' : 'Mute'}
          active={player.muted}
          onClick={() => getClient().audio.muteToggle().catch(() => {})}
        >
          <Icon name={player.muted ? 'mute' : 'volUp'} size={30} />
        </IconBtn>
        <IconBtn size={64} label="Volume up" onClick={() => nudge(1)}>
          <Icon name="volUp" size={30} />
        </IconBtn>
        {lyricsSupported !== false ? (
          <IconBtn
            size={64}
            label={lyricsTab ? 'Hide lyrics' : 'Show lyrics'}
            active={lyricsTab}
            onClick={() => setLyricsTab(v => !v)}
          >
            <Icon name="mix" size={30} />
          </IconBtn>
        ) : null}
        <button
          type="button"
          onClick={() => nav({ name: 'queue' })}
          className="flex h-16 items-center gap-2 rounded-full bg-white/10 px-5 text-xl active:bg-white/20"
        >
          <Icon name="queue" size={28} />
          {upcoming > 0 ? `${upcoming} up next` : 'Queue'}
        </button>
      </div>
    </div>
  );

  return (
    <div className="relative flex h-full flex-col">
      {portrait ? (
        <>
          <div className="flex min-h-0 items-center justify-center pt-4" style={{ flex: '62 0 0%' }}>
            {heroBlock}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto" style={{ flex: '38 0 0%' }}>
            {infoBlock}
          </div>
        </>
      ) : (
        <div className="flex min-h-0 flex-1 items-center">
          <div className="flex h-full w-[46%] items-center justify-center">{heroBlock}</div>
          <div className="flex h-full w-[54%] items-center">{infoBlock}</div>
        </div>
      )}
    </div>
  );
}
