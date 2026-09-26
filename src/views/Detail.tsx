import { useEffect, useState } from 'react';
import { trackActions } from '../actions';
import { cached, stickyGet, stickySet } from '../cache';
import {
  Artwork,
  Empty,
  Icon,
  IconBtn,
  Rise,
  SkeletonRow,
  Tile,
  TrackRow,
  friendlyError,
  useArt,
  useCachedArt,
  useLinkGen,
} from '../components';
import { player } from '../player';
import type { Album, Track } from '../jellyfin';
import type { ViewProps } from '../nav';

interface DetailParams {
  kind: 'album' | 'artist' | 'playlist' | 'genre';
  id: string;
  title: string;
}

interface StickyDetail {
  tracks: Track[];
  albums: Album[] | null;
}

function SkeletonDetail() {
  return (
    <div aria-hidden>
      <div className="px-5 pt-4 pb-5">
        <div className="skeleton mb-4 h-14 w-14 rounded-full" />
        <div className="flex items-center gap-4">
          <div className="skeleton h-36 w-36 shrink-0 rounded-2xl" />
          <div className="min-w-0 flex-1">
            <div className="skeleton h-9 w-3/4 rounded-lg" />
            <div className="skeleton mt-2 h-6 w-1/3 rounded-lg" />
          </div>
        </div>
        <div className="mt-4 flex gap-3">
          <div className="skeleton h-16 flex-1 rounded-full" />
          <div className="skeleton h-16 w-16 shrink-0 rounded-full" />
        </div>
      </div>
      <div className="px-4">
        {Array.from({ length: 6 }, (_, i) => (
          <SkeletonRow key={i} />
        ))}
      </div>
    </div>
  );
}

export default function Detail({ jf, nav, back, openMenu, params }: ViewProps & { params: DetailParams }) {
  const art = useArt();
  const [tracks, setTracks] = useState<Track[] | null>(null);
  const [albums, setAlbums] = useState<Album[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const linkGen = useLinkGen();

  // The phone link dropping mid-load is the common failure here; when it
  // comes back, retry automatically instead of parking on the error.
  useEffect(() => {
    if (linkGen > 0 && error) setRetryKey(k => k + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkGen]);

  useEffect(() => {
    let dead = false;
    const skey = `detail:${params.kind}:${params.id}`;
    // stale detail beats a spinner: seed from the sticky cache, then
    // revalidate in the background and overwrite on success.
    const sticky = stickyGet<StickyDetail>(skey);
    if (sticky) {
      setTracks(sticky.tracks);
      setAlbums(sticky.albums);
    } else {
      setTracks(null);
      setAlbums(null);
    }
    setError(null);
    const load = async (): Promise<void> => {
      try {
        let ts: Track[];
        let as: Album[] | null = null;
        if (params.kind === 'album') {
          ts = await cached(`detail:album:${params.id}`, () => jf.albumTracks(params.id));
        } else if (params.kind === 'artist') {
          const [t2, a2] = await Promise.all([
            cached(`detail:artist-tracks:${params.id}`, () => jf.artistTracks(params.id)),
            cached(`detail:artist-albums:${params.id}`, () => jf.artistAlbums(params.id)),
          ]);
          ts = t2;
          as = a2;
        } else if (params.kind === 'playlist') {
          ts = await cached(`detail:playlist:${params.id}`, () => jf.playlistItems(params.id));
        } else {
          ts = await cached(`detail:genre:${params.id}`, () => jf.genreTracks(params.id));
        }
        if (dead) return;
        setTracks(ts);
        setAlbums(as);
        setError(null);
        stickySet(skey, { tracks: ts, albums: as } satisfies StickyDetail);
      } catch (e) {
        // refresh failures stay silent when sticky data is showing
        if (!dead && !sticky) setError(friendlyError(e));
      }
    };
    void load();
    return () => {
      dead = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id, params.kind, retryKey]);

  const playAll = (shuffle: boolean): void => {
    if (tracks?.length) {
      nav({ name: 'nowplaying' });
      void player.playQueue(tracks, 0, shuffle);
    }
  };

  // Header art: the first track's art (album art for the album kind, which
  // previously showed no artwork at all). Doubles as the blurred backdrop.
  const headerSrc = tracks?.[0] ? (art?.trackArt(tracks[0], 256) ?? null) : null;
  const { url: bgUrl } = useCachedArt(headerSrc);

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        {error ? (
          <Empty text={`Could not load: ${error}`} onRetry={() => setRetryKey(k => k + 1)} />
        ) : !tracks ? (
          <SkeletonDetail />
        ) : tracks.length === 0 ? (
          <Empty text="Nothing here yet." />
        ) : (
          <>
            <div className="relative overflow-hidden">
              {bgUrl ? (
                <>
                  <img
                    src={bgUrl}
                    aria-hidden
                    draggable={false}
                    className="absolute inset-0 h-full w-full scale-125 object-cover opacity-40 blur-2xl"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/55 to-zinc-950/20" />
                </>
              ) : null}
              <div className="relative px-5 pt-4 pb-5">
                <div className="mb-4 flex items-center">
                  <IconBtn onClick={back} label="Back" size={56}>
                    <Icon name="back" size={30} />
                  </IconBtn>
                </div>
                <Rise>
                  <div className="flex items-center gap-4">
                    <Artwork src={headerSrc} size={144} rounded="rounded-2xl" label={params.title} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-3xl font-bold">{params.title}</div>
                      <div className="mt-1 text-xl text-white/55">
                        {tracks.length} track{tracks.length === 1 ? '' : 's'}
                      </div>
                    </div>
                  </div>
                  <div className="mt-4 flex gap-3">
                    <button
                      type="button"
                      onClick={() => playAll(false)}
                      className="flex h-16 flex-1 items-center justify-center gap-2 rounded-full bg-leaf text-2xl font-bold text-black active:brightness-90"
                    >
                      <Icon name="play" size={30} /> Play
                    </button>
                    <button
                      type="button"
                      aria-label="Shuffle play"
                      onClick={() => playAll(true)}
                      className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-white/10 active:bg-white/20"
                    >
                      <Icon name="shuffle" size={30} />
                    </button>
                  </div>
                </Rise>
              </div>
            </div>

            <div className="px-4 pb-4">
              {albums && albums.length ? (
                <div className="mb-5">
                  <h2 className="mb-3 px-1 text-2xl font-semibold">Albums</h2>
                  <div className="flex gap-5 overflow-x-auto px-1 pb-1">
                    {albums.map(a => (
                      <Tile
                        key={a.id}
                        size={200}
                        title={a.name}
                        subtitle={a.year ? String(a.year) : undefined}
                        art={art?.albumArt(a) ?? null}
                        onClick={() => nav({ name: 'detail', kind: 'album', id: a.id, title: a.name })}
                      />
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="flex flex-col gap-1">
                {tracks.map((t, i) => (
                  <TrackRow
                    key={t.id}
                    track={t}
                    art={params.kind === 'album' ? null : (art?.trackArt(t) ?? null)}
                    showArt={params.kind !== 'album'}
                    indexLabel={params.kind === 'album' ? String(i + 1) : undefined}
                    onPlay={() => {
                      nav({ name: 'nowplaying' });
                      void player.playQueue(tracks, i);
                    }}
                    onMenu={() => openMenu(t.name, trackActions(t, jf, nav))}
                  />
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
