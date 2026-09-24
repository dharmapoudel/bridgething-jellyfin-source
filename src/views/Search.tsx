import { useEffect, useRef, useState } from 'react';
import { albumActions, trackActions } from '../actions';
import { Empty, Icon, Keyboard, Spinner, Tile, TopBar, TrackRow, useArt } from '../components';
import { player } from '../player';
import type { SearchHits } from '../jellyfin';
import type { ViewProps } from '../nav';

export default function Search({ jf, nav, back, openMenu }: ViewProps) {
  const art = useArt();
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHits | null>(null);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (timer.current) window.clearTimeout(timer.current);
    const q = query.trim();
    if (!q) {
      setHits(null);
      setSearched(false);
      setSearching(false);
      return;
    }
    setSearching(true);
    timer.current = window.setTimeout(() => {
      let dead = false;
      jf.searchHints(q).then(
        h => {
          if (dead) return;
          setHits(h);
          setSearching(false);
          setSearched(true);
        },
        () => {
          if (dead) return;
          setSearching(false);
          setSearched(true);
        },
      );
      return () => {
        dead = true;
      };
    }, 450);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [query, jf]);

  return (
    <div className="flex h-full flex-col">
      <TopBar title="Search" onBack={back} />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {searching ? (
          <Spinner label="Searching…" />
        ) : !searched ? (
          <Empty text="Type to search your library: tracks, albums and artists." />
        ) : !hits || (!hits.tracks.length && !hits.albums.length && !hits.artists.length) ? (
          <Empty text={`No results for "${query.trim()}".`} />
        ) : (
          <>
            {hits.tracks.length ? (
              <section className="mb-6">
                <h2 className="mb-2 text-2xl font-semibold">Tracks</h2>
                {hits.tracks.map(t => (
                  <TrackRow
                    key={t.id}
                    track={t}
                    art={art?.trackArt(t) ?? null}
                    onPlay={() => {
                      void player.playQueue(hits.tracks, hits.tracks.indexOf(t));
                    }}
                    onMenu={() => openMenu(t.name, trackActions(t, jf, nav))}
                  />
                ))}
              </section>
            ) : null}
            {hits.albums.length ? (
              <section className="mb-6">
                <h2 className="mb-2 text-2xl font-semibold">Albums</h2>
                <div className="flex gap-4 overflow-x-auto pb-1">
                  {hits.albums.map(a => (
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
              </section>
            ) : null}
            {hits.artists.length ? (
              <section className="mb-6">
                <h2 className="mb-2 text-2xl font-semibold">Artists</h2>
                <div className="flex gap-4 overflow-x-auto pb-1">
                  {hits.artists.map(a => (
                    <Tile
                      key={a.id}
                      title={a.name}
                      art={art?.artistArt(a, 400) ?? null}
                      onClick={() => nav({ name: 'detail', kind: 'artist', id: a.id, title: a.name })}
                    />
                  ))}
                </div>
              </section>
            ) : null}
          </>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2 px-4 pb-2">
        <Icon name="search" size={26} className="shrink-0 text-white/50" />
        <div className="text-xl text-white/40">typing below searches as you go</div>
      </div>
      <Keyboard value={query} onChange={setQuery} onDone={() => setQuery(q => q)} />
    </div>
  );
}
