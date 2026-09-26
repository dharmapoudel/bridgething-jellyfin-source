import { useEffect, useState } from 'react';
import { albumActions, playlistActions, trackActions } from '../actions';
import { cached, stickyGet, stickySet } from '../cache';
import {
  AmbientArt,
  AuthError,
  Empty,
  Rise,
  SkeletonRow,
  SkeletonTile,
  Tile,
  TrackRow,
  useArt,
  useArtAccent,
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

function Rail({ title, onSeeAll, children }: { title: string; onSeeAll?: () => void; children: React.ReactNode }) {
  return (
    <section className="mb-7 shrink-0">
      <div className="mb-2 flex items-center justify-between px-5">
        <h2 className="text-xs font-semibold uppercase tracking-[0.22em] text-white/80">{title}</h2>
        {onSeeAll ? (
          <button type="button" onClick={onSeeAll} className="rounded-full px-4 py-2 text-lg font-medium text-goldlight active:bg-white/10">
            See all
          </button>
        ) : null}
      </div>
      <div className="flex gap-4 overflow-x-auto px-5 pb-1">{children}</div>
    </section>
  );
}

function SkeletonHome() {
  return (
    <div className="py-2" aria-hidden>
      {[0, 1].map(r => (
        <section key={r} className="mb-7">
          <div className="skeleton mx-5 mb-2 h-4 w-40 rounded" />
          <div className="flex gap-4 overflow-hidden px-5">
            {[0, 1, 2, 3].map(i => (
              <SkeletonTile key={i} size={180} />
            ))}
          </div>
        </section>
      ))}
      <section className="px-3">
        <div className="skeleton mx-2 mb-2.5 h-8 w-36 rounded-lg" />
        {[0, 1, 2].map(i => (
          <SkeletonRow key={i} />
        ))}
      </section>
    </div>
  );
}

export default function Home({ jf, nav, openMenu }: ViewProps) {
  const art = useArt();
  usePlayer();
  // The track Finch is actually playing right now (adopted on app start
  // when the phone kept playing across a restart): highlight its tile in
  // Continue listening, and tapping it opens Now Playing without
  // restarting it from scratch.
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

  // Ambient backdrop: the now-playing track's art when something is active,
  // otherwise the most recent track's. The accent glow is sampled from it.
  // Fixed so it paints behind the transparent top tab strip as well.
  const ambientTrack =
    (nowActive ? recent.data?.find(t => t.id === nowId) : null) ?? recent.data?.[0] ?? null;
  const ambientSrc = ambientTrack && art ? (art.trackArt(ambientTrack, 256) ?? null) : null;
  const accent = useArtAccent(ambientSrc);

  const anyError = recent.error || added.error || favs.error || playlists.error;

  return (
    <div className="relative h-full overflow-y-auto">
      <AmbientArt src={ambientSrc} accent={accent} height={340} fixed />
      <div className="relative pb-5 pt-2">
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

        {recent.data ? (
          <Rise>
            <Rail title="Continue listening">
              {recent.data.map((t, i) => {
                const isCurrent = nowActive && t.id === nowId;
                return (
                  <Rise key={t.id} i={i}>
                    <Tile
                      size={180}
                      title={t.name}
                      subtitle={t.artist}
                      art={art?.trackArt(t) ?? null}
                      active={isCurrent}
                      onClick={() => {
                        nav({ name: 'nowplaying' });
                        // Tapping the currently-playing tile just opens Now
                        // Playing; every other tile starts it from scratch.
                        if (!isCurrent) void player.playQueue(recent.data!, recent.data!.indexOf(t));
                      }}
                      onMenu={() => openMenu(t.name, menuFor(t))}
                    />
                  </Rise>
                );
              })}
            </Rail>
          </Rise>
        ) : (
          !recent.error && <SkeletonHome />
        )}

        {added.data ? (
          <Rise>
            <Rail title="Recently added" onSeeAll={() => nav({ name: 'library', tab: 'albums' })}>
              {added.data.map((a, i) => (
                <Rise key={a.id} i={i}>
                  <Tile
                    size={180}
                    title={a.name}
                    subtitle={a.artist}
                    art={art?.albumArt(a) ?? null}
                    onClick={() => nav({ name: 'detail', kind: 'album', id: a.id, title: a.name })}
                    onMenu={() => openMenu(a.name, albumActions(a, jf, nav))}
                  />
                </Rise>
              ))}
            </Rail>
          </Rise>
        ) : null}

        {favs.data && favs.data.length ? (
          <section className="mb-7 px-3">
            <h2 className="mb-2.5 px-2 text-2xl font-bold tracking-tight">Favorites</h2>
            {favs.data.slice(0, 5).map((t, i) => (
              <Rise key={t.id} i={i}>
                <TrackRow
                  track={t}
                  art={art?.trackArt(t) ?? null}
                  onPlay={() => {
                    nav({ name: 'nowplaying' });
                    void player.playQueue(favs.data!, favs.data!.indexOf(t));
                  }}
                  onMenu={() => openMenu(t.name, menuFor(t))}
                />
              </Rise>
            ))}
          </section>
        ) : null}

        {playlists.data && playlists.data.length ? (
          <Rise>
            <Rail title="Playlists" onSeeAll={() => nav({ name: 'library', tab: 'playlists' })}>
              {playlists.data.map((p, i) => (
                <Rise key={p.id} i={i}>
                  <Tile
                    size={180}
                    title={p.name}
                    subtitle={p.songCount ? `${p.songCount} tracks` : undefined}
                    art={art?.playlistArt(p) ?? null}
                    onClick={() => nav({ name: 'detail', kind: 'playlist', id: p.id, title: p.name })}
                    onMenu={() => openMenu(p.name, playlistActions(p, jf, nav))}
                  />
                </Rise>
              ))}
            </Rail>
          </Rise>
        ) : null}
      </div>
    </div>
  );
}
