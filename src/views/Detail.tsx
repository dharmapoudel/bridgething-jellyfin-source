import { useEffect, useState } from 'react';
import { trackActions } from '../actions';
import { cached } from '../cache';
import { Artwork, Empty, Icon, Spinner, Tile, TopBar, TrackRow, useArt } from '../components';
import { player } from '../player';
import type { Album, Track } from '../jellyfin';
import type { ViewProps } from '../nav';

interface DetailParams {
  kind: 'album' | 'artist' | 'playlist' | 'genre';
  id: string;
  title: string;
}

export default function Detail({ jf, nav, back, openMenu, params }: ViewProps & { params: DetailParams }) {
  const art = useArt();
  const [tracks, setTracks] = useState<Track[] | null>(null);
  const [albums, setAlbums] = useState<Album[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let dead = false;
    setTracks(null);
    setAlbums(null);
    setError(null);
    const load = async (): Promise<void> => {
      try {
        if (params.kind === 'album') {
          setTracks(await cached(`detail:album:${params.id}`, () => jf.albumTracks(params.id)));
        } else if (params.kind === 'artist') {
          const [ts, as] = await Promise.all([
            cached(`detail:artist-tracks:${params.id}`, () => jf.artistTracks(params.id)),
            cached(`detail:artist-albums:${params.id}`, () => jf.artistAlbums(params.id)),
          ]);
          if (!dead) {
            setTracks(ts);
            setAlbums(as);
          }
          return;
        } else if (params.kind === 'playlist') {
          setTracks(await cached(`detail:playlist:${params.id}`, () => jf.playlistItems(params.id)));
        } else {
          setTracks(await cached(`detail:genre:${params.id}`, () => jf.genreTracks(params.id)));
        }
      } catch (e) {
        if (!dead) setError(e instanceof Error ? e.message : 'could not load');
      }
    };
    void load();
    return () => {
      dead = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id, params.kind]);

  const playAll = (shuffle: boolean): void => {
    if (tracks?.length) void player.playQueue(tracks, 0, shuffle);
  };

  const headerArt = tracks?.[0] && params.kind !== 'album' ? (art?.trackArt(tracks[0], 400) ?? null) : null;

  return (
    <div className="flex h-full flex-col">
      <TopBar title={params.title} onBack={back} />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {error ? (
          <Empty text={`Could not load: ${error}`} />
        ) : !tracks ? (
          <Spinner />
        ) : tracks.length === 0 ? (
          <Empty text="Nothing here yet." />
        ) : (
          <>
            <div className="mb-4 flex items-center gap-4">
              {params.kind === 'album' || params.kind === 'artist' ? (
                <Artwork src={headerArt} size={120} label={params.title} />
              ) : null}
              <div className="min-w-0 flex-1">
                <div className="truncate text-3xl font-bold">{params.title}</div>
                <div className="text-xl text-white/50">
                  {tracks.length} track{tracks.length === 1 ? '' : 's'}
                </div>
              </div>
              <button
                type="button"
                onClick={() => playAll(false)}
                className="flex h-18 shrink-0 items-center gap-2 rounded-full bg-amber-400 px-6 text-2xl font-bold text-black active:bg-amber-300"
              >
                <Icon name="play" size={30} /> Play
              </button>
              <button
                type="button"
                aria-label="Shuffle play"
                onClick={() => playAll(true)}
                className="flex h-18 w-18 shrink-0 items-center justify-center rounded-full bg-white/10 active:bg-white/20"
              >
                <Icon name="shuffle" size={30} />
              </button>
            </div>

            {albums && albums.length ? (
              <div className="mb-4">
                <h2 className="mb-2 text-2xl font-semibold">Albums</h2>
                <div className="flex gap-4 overflow-x-auto pb-1">
                  {albums.map(a => (
                    <Tile
                      key={a.id}
                      title={a.name}
                      subtitle={a.year ? String(a.year) : undefined}
                      art={art?.albumArt(a) ?? null}
                      onClick={() => nav({ name: 'detail', kind: 'album', id: a.id, title: a.name })}
                    />
                  ))}
                </div>
              </div>
            ) : null}

            <div className="flex flex-col">
              {tracks.map((t, i) => (
                <TrackRow
                  key={t.id}
                  track={t}
                  art={params.kind === 'album' ? null : art?.trackArt(t) ?? null}
                  showArt={params.kind !== 'album'}
                  indexLabel={params.kind === 'album' ? String(i + 1) : undefined}
                  onPlay={() => {
                    void player.playQueue(tracks, i);
                  }}
                  onMenu={() => openMenu(t.name, trackActions(t, jf, nav))}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
