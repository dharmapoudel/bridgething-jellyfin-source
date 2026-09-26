import { Artwork, Empty, Icon, IconBtn, Rise, useArt, usePlayer } from '../components';
import { player } from '../player';
import type { ViewProps } from '../nav';

// The queue is a top-level tab now (the bottom sheet is gone): full-screen
// Up Next list, restyled to the 1.0.11 row language.
export default function Queue({ nav }: ViewProps) {
  usePlayer();
  const art = useArt();
  const upcoming = player.queue.slice(player.index + 1);
  const current = player.current();

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-16 shrink-0 items-center gap-3 border-b border-white/10 px-5">
        <h1 className="min-w-0 flex-1 truncate text-2xl font-semibold">
          Up next{upcoming.length ? ` (${upcoming.length})` : ''}
        </h1>
        {upcoming.length ? (
          <button
            type="button"
            onClick={() => player.clearQueue()}
            className="h-12 shrink-0 rounded-full bg-white/10 px-5 text-lg font-medium text-red-300 active:bg-white/20"
          >
            Clear
          </button>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {current ? (
          <Rise>
            <div className="mb-3 flex items-center gap-3 rounded-2xl bg-leaf/10 p-2.5">
              <button
                type="button"
                onClick={() => nav({ name: 'nowplaying' })}
                aria-label={`Open Now Playing for ${current.name}`}
                className="flex min-w-0 flex-1 items-center gap-3 text-left active:opacity-80"
              >
                <Artwork
                  src={art?.trackArt(current, 200) ?? null}
                  size={56}
                  rounded="rounded-xl"
                  label={current.album}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xl font-medium text-leaf">{current.name}</span>
                  <span className="block truncate text-base text-white/50">
                    Now playing · {current.artist}
                  </span>
                </span>
              </button>
              <IconBtn size={56} label={player.intentPlaying ? 'Pause' : 'Play'} onClick={() => void player.toggle()}>
                <Icon name={player.intentPlaying ? 'pause' : 'play'} size={28} />
              </IconBtn>
            </div>
          </Rise>
        ) : null}
        {upcoming.length === 0 ? (
          <Empty text={current ? 'The queue ends here.' : 'The queue is empty. Play something from your library.'} />
        ) : (
          <div className="flex flex-col gap-1">
            {upcoming.map((t, i) => {
              const qi = player.index + 1 + i;
              return (
                <div
                  key={`${t.id}-${qi}`}
                  className="flex min-h-[72px] items-center gap-3 rounded-2xl px-3 py-2 active:bg-white/8"
                >
                  <button
                    type="button"
                    onClick={() => void player.jumpTo(qi)}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  >
                    <Artwork src={art?.trackArt(t, 200) ?? null} size={56} rounded="rounded-xl" label={t.album} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xl leading-snug font-medium">{t.name}</span>
                      <span className="block truncate text-base leading-snug text-white/50">{t.artist}</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove ${t.name} from queue`}
                    onClick={() => player.removeAt(qi)}
                    className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-white/50 active:bg-white/15"
                  >
                    <Icon name="x" size={26} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
