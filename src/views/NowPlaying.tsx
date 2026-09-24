import { useState } from 'react';
import { getClient } from '../client';
import { Artwork, Icon, IconBtn, ProgressBar, useArt, usePlayer, usePortrait } from '../components';
import { player } from '../player';
import type { ViewProps } from '../nav';

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
  const [lyricsOpen, setLyricsOpen] = useState(false);
  const [lyrics, setLyrics] = useState<string | null>(null);
  const [lyricsLoading, setLyricsLoading] = useState(false);
  const t = player.current();

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

  const openLyrics = (): void => {
    setLyricsOpen(true);
    setLyricsLoading(true);
    setLyrics(null);
    getClient()
      .lyrics.get()
      .then(
        r => {
          setLyricsLoading(false);
          if (r.ok) {
            const lines = (r.response as unknown as { lines?: { text: string }[] }).lines;
            setLyrics(lines?.map(l => l.text).join('\n') || 'No lyrics for this track.');
          } else {
            setLyrics('No lyrics for this track.');
          }
        },
        () => {
          setLyricsLoading(false);
          setLyrics('No lyrics for this track.');
        },
      );
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
        <IconBtn size={64} label="Lyrics" onClick={openLyrics}>
          <Icon name="mix" size={30} />
        </IconBtn>
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
          <div className="flex items-center justify-center pt-4" style={{ flex: '62 0 0%' }}>
            {artBlock}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto" style={{ flex: '38 0 0%' }}>
            {infoBlock}
          </div>
        </>
      ) : (
        <div className="flex min-h-0 flex-1 items-center">
          <div className="flex h-full w-[46%] items-center justify-center">{artBlock}</div>
          <div className="flex h-full w-[54%] items-center">{infoBlock}</div>
        </div>
      )}
      {lyricsOpen ? (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 p-8" onClick={() => setLyricsOpen(false)}>
          <div
            className="flex max-h-full w-full max-w-2xl flex-col rounded-3xl bg-zinc-900 p-6"
            onClick={e => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <div className="text-2xl font-semibold">Lyrics</div>
              <IconBtn size={56} label="Close lyrics" onClick={() => setLyricsOpen(false)}>
                <Icon name="x" size={28} />
              </IconBtn>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto text-center text-2xl leading-relaxed whitespace-pre-line">
              {lyricsLoading ? 'Loading…' : lyrics}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
