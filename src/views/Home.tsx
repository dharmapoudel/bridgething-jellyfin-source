import { useEffect, useState } from 'react';
import { albumActions, playlistActions, trackActions } from '../actions';
import { cached, stickyGet, stickySet } from '../cache';
import { AuthError, Empty, Spinner, Tile, TrackRow, useArt, warmArt, type MenuAction } from '../components';
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
    <section className="mb-6 shrink-0">
      <div className="mb-2 flex items-center justify-between px-4">
        <h2 className="text-2xl font-semibold">{title}</h2>
        {onSeeAll ? (
          <button type="button" onClick={onSeeAll} className="rounded-full px-4 py-2 text-lg text-goldlight active:bg-white/10">
            See all
          </button>
        ) : null}
      </div>
      <div className="flex gap-4 overflow-x-auto px-4 pb-1">{children}</div>
    </section>
  );
}

export default function Home({ jf, nav, openMenu }: ViewProps) {
  const art = useArt();

  const recent = useLoad<Track[]>('home:recent', () => jf.recentlyPlayedTracks(12));
  const added = useLoad<Album[]>('home:added', () => jf.recentlyAddedAlbums(12));
  const favs = useLoad<Track[]>('home:favs', () => jf.favorites().then(f => f.slice(0, 12)));
  const playlists = useLoad<Playlist[]>('home:playlists', () => jf.playlists().then(p => p.slice(0, 12)));

  // prefetch artwork for freshly loaded rails so tiles paint instantly
  useEffect(() => {
    warmArt([
      ...(recent.data ?? []).map(t => art?.trackArt(t)),
      ...(added.data ?? []).map(a => art?.albumArt(a)),
      ...(favs.data ?? []).map(t => art?.trackArt(t)),
      ...(playlists.data ?? []).map(p => art?.playlistArt(p)),
    ]);
  }, [recent.data, added.data, favs.data, playlists.data, art]);

  const menuFor = (t: Track): MenuAction[] => trackActions(t, jf, nav);

  return (
    <div className="h-full overflow-y-auto py-4">
        {recent.error || added.error || favs.error || playlists.error ? (
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
          <Rail title="Continue listening">
            {recent.data.map(t => (
              <Tile
                key={t.id}
                title={t.name}
                subtitle={t.artist}
                art={art?.trackArt(t) ?? null}
                onClick={() => {
                  void player.playQueue(recent.data!, recent.data!.indexOf(t));
                }}
                onMenu={() => openMenu(t.name, menuFor(t))}
              />
            ))}
          </Rail>
        ) : (
          !recent.error && <Spinner label="Loading your music…" />
        )}

        {added.data ? (
          <Rail title="Recently added" onSeeAll={() => nav({ name: 'library', tab: 'albums' })}>
            {added.data.map(a => (
              <Tile
                key={a.id}
                title={a.name}
                subtitle={a.artist}
                art={art?.albumArt(a) ?? null}
                onClick={() => nav({ name: 'detail', kind: 'album', id: a.id, title: a.name })}
                onMenu={() => openMenu(a.name, albumActions(a, jf, nav))}
              />
            ))}
          </Rail>
        ) : null}

        {favs.data && favs.data.length ? (
          <section className="mb-6 px-2">
            <h2 className="mb-2 px-2 text-2xl font-semibold">Favorites</h2>
            {favs.data.slice(0, 5).map(t => (
              <TrackRow
                key={t.id}
                track={t}
                art={art?.trackArt(t) ?? null}
                onPlay={() => {
                  void player.playQueue(favs.data!, favs.data!.indexOf(t));
                }}
                onMenu={() => openMenu(t.name, menuFor(t))}
              />
            ))}
          </section>
        ) : null}

        {playlists.data && playlists.data.length ? (
          <Rail title="Playlists" onSeeAll={() => nav({ name: 'library', tab: 'playlists' })}>
            {playlists.data.map(p => (
              <Tile
                key={p.id}
                title={p.name}
                subtitle={p.songCount ? `${p.songCount} tracks` : undefined}
                art={art?.playlistArt(p) ?? null}
                onClick={() => nav({ name: 'detail', kind: 'playlist', id: p.id, title: p.name })}
                onMenu={() => openMenu(p.name, playlistActions(p, jf, nav))}
              />
            ))}
          </Rail>
        ) : null}
    </div>
  );
}
