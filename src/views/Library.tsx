import { useEffect, useRef, useState } from 'react';
import { albumActions, playlistActions } from '../actions';
import { cached, stickyGet, stickySet } from '../cache';
import { AuthError, Empty, GridCard, Rise, SkeletonGridCard, friendlyError, useArt, useLinkGen } from '../components';
import { player } from '../player';
import { isAuthError, type Album, type Artist, type Genre, type Playlist } from '../jellyfin';
import type { LibTab, ViewProps } from '../nav';

// One Bluetooth-tunneled list response must stay small: the albums/artists
// tabs page through the library instead of fetching it as one giant JSON
// blob (a multi-thousand-album library in a single frame is what was
// knocking the link over). Pages render progressively and the rest fill in
// behind while the user browses.
const LIB_PAGE = 120;

// Keep-alive across unmounts: opening a playlist/album unmounts this view,
// and coming back shouldn't jump to the top or refetch everything.
const scrollTops = new Map<LibTab, number>();
const lastFullLoad = new Map<LibTab, number>();
const FRESH_MS = 5 * 60 * 1000;

const TABS: { id: LibTab; label: string }[] = [
  { id: 'playlists', label: 'Playlists' },
  { id: 'albums', label: 'Albums' },
  { id: 'artists', label: 'Artists' },
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
  const [loadingMore, setLoadingMore] = useState(false);
  const linkGen = useLinkGen();
  const scrollRef = useRef<HTMLDivElement>(null);
  const tabRef = useRef(tab);
  tabRef.current = tab;
  // Which tab we've already restored the scroll position for in this mount;
  // reset whenever the tab changes so each tab keeps its own position.
  const restoredRef = useRef<LibTab | null>(null);

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
    setLoadingMore(false);
    // Back-nav keep-alive: if this tab fully loaded recently and the sticky
    // cache still has it, don't refetch — the list paints from sticky and
    // the scroll position (below) is preserved. Manual/link retries bypass.
    const stickyKey = `lib:${tab}`;
    const seeded = !!stickyGet<unknown[]>(stickyKey)?.length;
    if (retryKey === 0 && seeded && Date.now() - (lastFullLoad.get(tab) ?? 0) < FRESH_MS) {
      return () => {
        dead = true;
      };
    }
    // Page through a large list in bounded frames, rendering progressively.
    // Tab switches and retries abandon the loop via `dead`.
    const loadPaged = async <T,>(
      key: string,
      fetchPage: (start: number, limit: number) => Promise<T[]>,
      setData: (d: T[]) => void,
    ): Promise<void> => {
      const hasData = !!stickyGet<unknown[]>(key)?.length;
      const all: T[] = [];
      let start = 0;
      for (;;) {
        let page: T[];
        try {
          page = await fetchPage(start, LIB_PAGE);
        } catch (e) {
          if (!dead && all.length === 0 && !hasData) {
            setError(friendlyError(e));
            setRawError(e);
          }
          // Otherwise keep what we have; a later visit retries.
          if (!dead) setLoadingMore(false);
          return;
        }
        if (dead) return;
        all.push(...page);
        setData([...all]);
        if (page.length < LIB_PAGE) break;
        setLoadingMore(true);
        start += LIB_PAGE;
      }
      if (!dead) {
        setLoadingMore(false);
        stickySet(key, all);
        lastFullLoad.set(tab, Date.now());
      }
    };
    const load = async (): Promise<void> => {
      try {
        if (tab === 'albums') {
          await loadPaged('lib:albums', (s, l) => jf.albums(s, l), setAlbums);
          return;
        }
        if (tab === 'artists') {
          await loadPaged('lib:artists', (s, l) => jf.artists(s, l), setArtists);
          return;
        }
        if (tab === 'playlists') {
          const d = await cached('lib:playlists', () => jf.playlists());
          if (!dead) {
            setPlaylists(d);
            stickySet('lib:playlists', d);
            lastFullLoad.set(tab, Date.now());
          }
        }
        if (tab === 'genres') {
          const d = await cached('lib:genres', () => jf.genres());
          if (!dead) {
            setGenres(d);
            stickySet('lib:genres', d);
            lastFullLoad.set(tab, Date.now());
          }
        }
      } catch (e) {
        if (!dead && !seeded) {
          // stale list beats an error banner when we have one
          setError(friendlyError(e));
          setRawError(e);
        }
      }
    };
    void load();
    return () => {
      dead = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, retryKey]);

  // Restore this tab's scroll position once its list has painted (sticky
  // seed or fresh load). Runs every render but restores only once per tab;
  // progressive page appends must not yank the scroll back.
  useEffect(() => {
    if (restoredRef.current === tab) return;
    const el = scrollRef.current;
    if (!el) return;
    const dataPresent =
      (tab === 'albums' && albums) ||
      (tab === 'artists' && artists) ||
      (tab === 'playlists' && playlists) ||
      (tab === 'genres' && genres);
    if (!dataPresent) return;
    restoredRef.current = tab;
    const y = scrollTops.get(tab) ?? 0;
    if (y > 0) el.scrollTop = y;
  });

  // Backstop: persist the scroll position when this view unmounts (opening
  // a playlist/album). The onScroll handler below keeps it current; this
  // covers unmounts with no preceding scroll event.
  useEffect(() => {
    return () => {
      const el = scrollRef.current;
      if (el) scrollTops.set(tabRef.current, el.scrollTop);
    };
  }, []);

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

  // Artwork loads on demand as tiles mount (IntersectionObserver + the
  // 4-concurrent gate in components.tsx). The old warmArt prefetch fired up
  // to 48 image fetches at the exact moment the list JSON was in flight,
  // and that combined burst was knocking the Bluetooth link over — so no
  // prefetch here; visible tiles still paint fast via the demand loader.

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-white/10 px-3">
        {TABS.map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`relative h-14 shrink-0 px-5 text-xl font-semibold ${
              tab === t.id ? 'text-leaf' : 'text-white/55 active:text-white'
            }`}
          >
            {t.label}
            {tab === t.id ? <span className="absolute inset-x-4 bottom-0 h-[3px] rounded-full bg-leaf" /> : null}
          </button>
        ))}
      </div>
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto p-4"
        onScroll={e => scrollTops.set(tabRef.current, e.currentTarget.scrollTop)}
      >
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
            <Rise>
              <div className="grid grid-cols-3 gap-x-4 gap-y-6">
                {albums.map(a => (
                  <GridCard
                    key={a.id}
                    title={a.name}
                    subtitle={a.artist}
                    art={art?.albumArt(a) ?? null}
                    onClick={() => nav({ name: 'detail', kind: 'album', id: a.id, title: a.name })}
                    onMenu={() => openMenu(a.name, albumActions(a, jf, nav))}
                  />
                ))}
              </div>
              {loadingMore && <p className="mt-4 text-center text-base text-white/40">Loading more…</p>}
            </Rise>
          ) : (
            <div className="grid grid-cols-3 gap-x-4 gap-y-6" aria-hidden>
              {Array.from({ length: 9 }, (_, i) => (
                <SkeletonGridCard key={i} />
              ))}
            </div>
          )
        ) : tab === 'artists' ? (
          artists ? (
            <Rise>
              <div className="grid grid-cols-3 gap-x-4 gap-y-6">
                {artists.map(a => (
                  <GridCard
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
              {loadingMore && <p className="mt-4 text-center text-base text-white/40">Loading more…</p>}
            </Rise>
          ) : (
            <div className="grid grid-cols-3 gap-x-4 gap-y-6" aria-hidden>
              {Array.from({ length: 9 }, (_, i) => (
                <SkeletonGridCard key={i} />
              ))}
            </div>
          )
        ) : tab === 'playlists' ? (
          playlists ? (
            <Rise>
              <div className="grid grid-cols-3 gap-x-4 gap-y-6">
                {playlists.map(p => (
                  <GridCard
                    key={p.id}
                    title={p.name}
                    subtitle={p.songCount ? `${p.songCount} tracks` : undefined}
                    art={art?.playlistArt(p) ?? null}
                    onClick={() => nav({ name: 'detail', kind: 'playlist', id: p.id, title: p.name })}
                    onMenu={() => openMenu(p.name, playlistActions(p, jf, nav))}
                  />
                ))}
              </div>
            </Rise>
          ) : (
            <div className="grid grid-cols-3 gap-x-4 gap-y-6" aria-hidden>
              {Array.from({ length: 9 }, (_, i) => (
                <SkeletonGridCard key={i} />
              ))}
            </div>
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
          <div className="flex flex-wrap gap-3" aria-hidden>
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="skeleton h-20 w-40 rounded-2xl" />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
