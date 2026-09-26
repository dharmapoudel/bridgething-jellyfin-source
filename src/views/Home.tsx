import { useEffect, useState } from 'react';
import { albumActions, playlistActions, trackActions } from '../actions';
import { cached, stickyGet, stickySet } from '../cache';
import {
  Artwork,
  AuthError,
  Empty,
  Icon,
  Rise,
  SkeletonTile,
  Tile,
  useArt,
  usePlayer,
  type MenuAction,
} from '../components';
import { player } from '../player';
import { isAuthError, type Album, type Playlist, type Track } from '../jellyfin';
import type { ViewProps } from '../nav';

function useLoad<T>(key: string | null, load: () => Promise<T>): {
  data: T | null;
  error: string | null;
  rawError: unknown;
} {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rawError, setRawError] = useState<unknown>(null);
  useEffect(() => {
    if (!key) return;
    let dead = false;
    setError(null);
    setRawError(null);
    // Seed from the sticky cache first: a cold start paints the last known
    // rails instantly, then the network refresh replaces them silently.
    const sticky = stickyGet<T>(key);
    setData(sticky);
    cached(key, load).then(
      d => {
        if (dead) return;
        setData(d);
        stickySet(key, d);
      },
      (e: unknown) => {
        if (dead) return;
        if (sticky) return; // stale data beats an error banner
        setError(e instanceof Error ? e.message : 'could not load');
        setRawError(e);
      },
    );
    return () => {
      dead = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return { data, error, rawError };
}

function Rail({
  title,
  onShowMore,
  children,
}: {
  title: string;
  onShowMore?: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-7 shrink-0">
      <div className="mb-3 flex items-center justify-between px-5">
        <h2 className="text-2xl font-semibold">{title}</h2>
        {onShowMore ? (
          <button
            type="button"
            onClick={onShowMore}
            className="rounded-full px-3 py-2 text-lg font-medium text-leaf active:bg-white/10"
          >
            Show more
          </button>
        ) : null}
      </div>
      <div className="flex gap-5 overflow-x-auto px-5 pb-1">{children}</div>
    </section>
  );
}

function SkeletonHome() {
  return (
    <div className="py-5" aria-hidden>
      <div className="mb-7 px-5">
        <div className="skeleton mb-3 h-8 w-56 rounded-lg" />
        <div className="flex items-center gap-4 rounded-3xl bg-white/5 p-4">
          <div className="skeleton h-36 w-36 shrink-0 rounded-2xl" />
          <div className="min-w-0 flex-1">
            <div className="skeleton h-8 w-3/4 rounded-lg" />
            <div className="skeleton mt-2 h-6 w-1/2 rounded-lg" />
          </div>
          <div className="skeleton h-[72px] w-[72px] shrink-0 rounded-full" />
        </div>
      </div>
      {[0, 1].map(r => (
        <div key={r} className="mb-7">
          <div className="skeleton mx-5 mb-3 h-8 w-44 rounded-lg" />
          <div className="flex gap-5 px-5">
            {[0, 1, 2, 3].map(i => (
              <SkeletonTile key={i} size={200} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function Home({ jf, nav, openMenu }: ViewProps) {
  const art = useArt();
  usePlayer();
  // The track Finch is actually playing right now (adopted on app start
  // when the phone kept playing across a restart): the hero resumes it
  // without restarting it from scratch.
  const nowId = player.current()?.id ?? null;
  const nowActive =
    nowId !== null && !player.external && !player.error && (player.intentPlaying || player.loading);

  const recent = useLoad<Track[]>('home:recent', () => jf.recentlyPlayedTracks(12));
  const added = useLoad<Album[]>('home:added', () => jf.recentlyAddedAlbums(12));
  // Server-side limits: fetching every favorite/playlist as one giant JSON
  // blob was knocking the Bluetooth link over; only 12 are ever shown.
  const favs = useLoad<Track[]>('home:favs', () => jf.favorites(12));
  const playlists = useLoad<Playlist[]>('home:playlists', () => jf.playlists(12));

  // No artwork prefetch on Home mount: the rails' JSON is in flight at the
  // same moment, and the combined burst was dropping the Bluetooth link.
  // Visible tiles load on demand via the IntersectionObserver loader.

  const menuFor = (t: Track): MenuAction[] => trackActions(t, jf, nav);
  const anyData = recent.data || added.data || favs.data || playlists.data;
  const anyError = recent.error || added.error || favs.error || playlists.error;

  const playTrack = (list: Track[], i: number): void => {
    nav({ name: 'nowplaying' });
    void player.playQueue(list, i);
  };

  // The hero resumes what's playing, otherwise the most recent track.
  const heroTrack = nowActive ? (recent.data?.find(t => t.id === nowId) ?? player.current()) : (recent.data?.[0] ?? null);
  const heroIsCurrent = nowActive && heroTrack?.id === nowId;

  return (
    <div className="h-full overflow-y-auto py-5">
      {anyError ? (
        isAuthError(recent.rawError) ||
        isAuthError(added.rawError) ||
        isAuthError(favs.rawError) ||
        isAuthError(playlists.rawError) ? (
          <AuthError
            text="Jellyfin rejected the saved sign-in. Reconnect with Quick Connect or an API key."
            onReconnect={() => nav({ name: 'setup' })}
          />
        ) : (
          <Empty text="Could not reach Jellyfin. Check the server URL and API key in settings." />
        )
      ) : null}

      {!anyData && !anyError ? (
        <SkeletonHome />
      ) : (
        <>
          {heroTrack ? (
            <Rise>
              <section className="mb-7 px-5">
                <h2 className="mb-3 text-2xl font-semibold">Continue listening</h2>
                <button
                  type="button"
                  onClick={() => {
                    if (heroIsCurrent) {
                      nav({ name: 'nowplaying' });
                    } else if (recent.data) {
                      const i = recent.data.findIndex(t => t.id === heroTrack.id);
                      playTrack(recent.data, Math.max(0, i));
                    }
                  }}
                  className="flex w-full items-center gap-4 rounded-3xl bg-white/8 p-4 text-left active:bg-white/12"
                >
                  <Artwork
                    src={art?.trackArt(heroTrack, 288) ?? null}
                    size={144}
                    rounded="rounded-2xl"
                    label={heroTrack.album}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-2xl leading-tight font-bold">{heroTrack.name}</span>
                    <span className="mt-1 block truncate text-lg leading-tight text-white/55">
                      {heroTrack.artist}
                      {heroIsCurrent ? ' · Now playing' : ''}
                    </span>
                  </span>
                  <span className="flex h-[72px] w-[72px] shrink-0 items-center justify-center rounded-full bg-leaf text-black">
                    <Icon name={heroIsCurrent && player.intentPlaying ? 'pause' : 'play'} size={34} />
                  </span>
                </button>
              </section>
            </Rise>
          ) : null}

          {recent.data ? (
            <Rise i={1}>
              <Rail title="Recently played">
                {recent.data.map(t => {
                  const isCurrent = nowActive && t.id === nowId;
                  return (
                    <Tile
                      key={t.id}
                      size={200}
                      title={t.name}
                      subtitle={t.artist}
                      art={art?.trackArt(t) ?? null}
                      active={isCurrent}
                      onClick={() => {
                        if (isCurrent) nav({ name: 'nowplaying' });
                        else playTrack(recent.data!, recent.data!.indexOf(t));
                      }}
                      onMenu={() => openMenu(t.name, menuFor(t))}
                    />
                  );
                })}
              </Rail>
            </Rise>
          ) : null}

          {added.data ? (
            <Rise i={2}>
              <Rail title="Recently added" onShowMore={() => nav({ name: 'library', tab: 'albums' })}>
                {added.data.map(a => (
                  <Tile
                    key={a.id}
                    size={200}
                    title={a.name}
                    subtitle={a.artist}
                    art={art?.albumArt(a) ?? null}
                    onClick={() => nav({ name: 'detail', kind: 'album', id: a.id, title: a.name })}
                    onMenu={() => openMenu(a.name, albumActions(a, jf, nav))}
                  />
                ))}
              </Rail>
            </Rise>
          ) : null}

          {favs.data && favs.data.length ? (
            <Rise i={3}>
              <Rail title="Favorites">
                {favs.data.map(t => (
                  <Tile
                    key={t.id}
                    size={200}
                    title={t.name}
                    subtitle={t.artist}
                    art={art?.trackArt(t) ?? null}
                    onClick={() => playTrack(favs.data!, favs.data!.indexOf(t))}
                    onMenu={() => openMenu(t.name, menuFor(t))}
                  />
                ))}
              </Rail>
            </Rise>
          ) : null}

          {playlists.data && playlists.data.length ? (
            <Rise i={4}>
              <Rail title="Playlists" onShowMore={() => nav({ name: 'library', tab: 'playlists' })}>
                {playlists.data.map(p => (
                  <Tile
                    key={p.id}
                    size={200}
                    title={p.name}
                    subtitle={p.songCount ? `${p.songCount} tracks` : undefined}
                    art={art?.playlistArt(p) ?? null}
                    onClick={() => nav({ name: 'detail', kind: 'playlist', id: p.id, title: p.name })}
                    onMenu={() => openMenu(p.name, playlistActions(p, jf, nav))}
                  />
                ))}
              </Rail>
            </Rise>
          ) : null}
        </>
      )}
    </div>
  );
}
