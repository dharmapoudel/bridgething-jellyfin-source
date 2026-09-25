import { useEffect, useState } from 'react';
import { albumActions, playlistActions } from '../actions';
import { cached, stickyGet, stickySet } from '../cache';
import { AuthError, Empty, Spinner, Tile, friendlyError, useArt, useLinkGen, warmArt, cancelWarmArt } from '../components';
import { player } from '../player';
import { isAuthError, type Album, type Artist, type Genre, type Playlist } from '../jellyfin';
import type { LibTab, ViewProps } from '../nav';

const TABS: { id: LibTab; label: string }[] = [
  { id: 'albums', label: 'Albums' },
  { id: 'artists', label: 'Artists' },
  { id: 'playlists', label: 'Playlists' },
  { id: 'genres', label: 'Genres' },
];

export default function Library({ jf, nav, openMenu, initialTab }: ViewProps & { initialTab: LibTab }) {
  const art = useArt();
  const [tab, setTab] = useState<LibTab>(initialTab);
  const [albums, setAlbums] = useState<Album[] | null>(null);
  const [artists, setArtists] = useState<Artist[] | null>(null);
  const [playlists, setPlaylists] = useState<Playlist[] | null>(null);
  const [genres, setGenres] = useState<Genre[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rawError, setRawError] = useState<unknown>(null);
  const [retryKey, setRetryKey] = useState(0);
  const linkGen = useLinkGen();

  useEffect(() => setTab(initialTab), [initialTab]);

  // The phone link dropping mid-load is the common failure here; when it
  // comes back, retry automatically instead of parking on the error.
  useEffect(() => {
    if (linkGen > 0 && error) setRetryKey(k => k + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkGen]);

  // Seed each tab from the sticky cache so a cold start paints the last known
  // library instantly; the per-tab refresh below keeps it honest.
  useEffect(() => {
    setAlbums(stickyGet<Album[]>('lib:albums'));
    setArtists(stickyGet<Artist[]>('lib:artists'));
    setPlaylists(stickyGet<Playlist[]>('lib:playlists'));
    setGenres(stickyGet<Genre[]>('lib:genres'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let dead = false;
    setError(null);
    setRawError(null);
    const load = async (): Promise<void> => {
      try {
        if (tab === 'albums') {
          const d = await cached('lib:albums', () => jf.albums());
          if (!dead) {
            setAlbums(d);
            stickySet('lib:albums', d);
          }
        }
        if (tab === 'artists') {
          const d = await cached('lib:artists', () => jf.artists());
          if (!dead) {
            setArtists(d);
            stickySet('lib:artists', d);
          }
        }
        if (tab === 'playlists') {
          const d = await cached('lib:playlists', () => jf.playlists());
          if (!dead) {
            setPlaylists(d);
            stickySet('lib:playlists', d);
          }
        }
        if (tab === 'genres') {
          const d = await cached('lib:genres', () => jf.genres());
          if (!dead) {
            setGenres(d);
            stickySet('lib:genres', d);
          }
        }
      } catch (e) {
        if (!dead) {
          // stale list beats an error banner when we have one
          const hasData =
            (tab === 'albums' && albums) ||
            (tab === 'artists' && artists) ||
            (tab === 'playlists' && playlists) ||
            (tab === 'genres' && genres);
          if (!hasData) {
            setError(friendlyError(e));
            setRawError(e);
          }
        }
      }
    };
    void load();
    return () => {
      dead = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, retryKey]);

  const shuffleArtist = (a: Artist, shuffle: boolean): void => {
    jf.artistTracks(a.id)
      .then(ts => {
        if (ts.length) {
          nav({ name: 'nowplaying' });
          return player.playQueue(ts, 0, shuffle);
        }
      })
      .catch(() => {});
  };

  // prefetch artwork for the current tab only (capped, throttled, and
  // cancellable): the old version fired one daemon fetch per album/artist/
  // playlist at once, and the burst was knocking the Bluetooth link over.
  useEffect(() => {
    cancelWarmArt();
    const srcs =
      tab === 'albums'
        ? (albums ?? []).map(a => art?.albumArt(a))
        : tab === 'artists'
          ? (artists ?? []).map(a => art?.artistArt(a))
          : tab === 'playlists'
            ? (playlists ?? []).map(p => art?.playlistArt(p))
            : [];
    if (srcs.length) warmArt(srcs);
    return () => {
      cancelWarmArt();
    };
  }, [tab, albums, artists, playlists, art]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 gap-2 overflow-x-auto border-b border-white/10 p-3">
        {TABS.map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`h-14 shrink-0 rounded-full px-6 text-xl font-medium ${
              tab === t.id ? 'bg-leaf text-black' : 'bg-white/10 text-white/80 active:bg-white/20'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {error ? (
          isAuthError(rawError) ? (
            <AuthError
              text="Jellyfin rejected the saved sign-in. Reconnect with Quick Connect or an API key."
              onReconnect={() => nav({ name: 'setup' })}
            />
          ) : (
            <Empty text={`Could not load the library: ${error}`} onRetry={() => setRetryKey(k => k + 1)} />
          )
        ) : tab === 'albums' ? (
          albums ? (
            <div className="flex flex-wrap gap-4">
              {albums.map(a => (
                <Tile
                  key={a.id}
                  title={a.name}
                  subtitle={a.artist}
                  art={art?.albumArt(a) ?? null}
                  onClick={() => nav({ name: 'detail', kind: 'album', id: a.id, title: a.name })}
                  onMenu={() => openMenu(a.name, albumActions(a, jf, nav))}
                />
              ))}
            </div>
          ) : (
            <Spinner />
          )
        ) : tab === 'artists' ? (
          artists ? (
            <div className="flex flex-wrap gap-4">
              {artists.map(a => (
                <Tile
                  key={a.id}
                  title={a.name}
                  art={art?.artistArt(a) ?? null}
                  onClick={() => nav({ name: 'detail', kind: 'artist', id: a.id, title: a.name })}
                  onMenu={() =>
                    openMenu(a.name, [
                      { label: 'Shuffle artist', icon: 'shuffle', run: () => shuffleArtist(a, true) },
                      { label: 'Play artist', icon: 'play', run: () => shuffleArtist(a, false) },
                    ])
                  }
                />
              ))}
            </div>
          ) : (
            <Spinner />
          )
        ) : tab === 'playlists' ? (
          playlists ? (
            <div className="flex flex-wrap gap-4">
              {playlists.map(p => (
                <Tile
                  key={p.id}
                  title={p.name}
                  subtitle={p.songCount ? `${p.songCount} tracks` : undefined}
                  art={art?.playlistArt(p) ?? null}
                  onClick={() => nav({ name: 'detail', kind: 'playlist', id: p.id, title: p.name })}
                  onMenu={() => openMenu(p.name, playlistActions(p, jf, nav))}
                />
              ))}
            </div>
          ) : (
            <Spinner />
          )
        ) : genres ? (
          <div className="flex flex-wrap gap-3">
            {genres.map(g => (
              <button
                key={g.id}
                type="button"
                onClick={() => nav({ name: 'detail', kind: 'genre', id: g.id, title: g.name })}
                className="h-20 shrink-0 rounded-2xl bg-white/10 px-6 text-2xl font-medium active:bg-white/20"
              >
                {g.name}
              </button>
            ))}
          </div>
        ) : (
          <Spinner />
        )}
      </div>
    </div>
  );
}
