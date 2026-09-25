// shared ui: icons, artwork, tiles, rows, keyboard, progress, menus.
// every interactive target is at least 64px; no vw/vh or fixed positioning
// for layout, the daemon pins the viewport at 800x480 and rotates the page.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { player } from './player';
import { getClient } from './client';
import type { Album, Artist, Playlist, Track } from './jellyfin';

// ---- artwork cache ----
// Small images, fetched once through the daemon and kept as in-memory blob
// URLs: every repeat render (scrolling back, switching tabs) is instant and
// never re-hits the server. LRU-capped so memory stays bounded.
const ART_CACHE_MAX = 120;
const artObjects = new Map<string, string>(); // source url -> blob object url
const artInflight = new Map<string, Promise<string | null>>();

function evictOldestArt(): void {
  const oldest = artObjects.keys().next();
  if (oldest.done) return;
  const obj = artObjects.get(oldest.value);
  if (obj) URL.revokeObjectURL(obj);
  artObjects.delete(oldest.value);
}

async function loadArt(url: string): Promise<string | null> {
  const hit = artObjects.get(url);
  if (hit) {
    artObjects.delete(url);
    artObjects.set(url, hit); // refresh LRU order
    return hit;
  }
  const inflight = artInflight.get(url);
  if (inflight) return inflight;
  // Gate every daemon fetch behind a small concurrency semaphore. Without it,
  // opening the library fires one fetch per tile (hundreds at once) and the
  // burst has been observed knocking the Bluetooth link over. Demand loads
  // (gen -1) are never skipped; see warmArt for cancellable prefetch.
  const p = new Promise<string | null>(resolve => {
    artQueue.push({ url, gen: -1, resolve });
    pumpArt();
  });
  artInflight.set(url, p);
  return p;
}

const ART_CONCURRENCY = 4;
let artActive = 0;
// gen: prefetch generation at enqueue time. Demand loads use gen -1 (never
// stale); prefetches carry the warmArt generation and are skipped if a newer
// batch cancelled them before their slot came up.
const artQueue: { url: string; gen: number; resolve: (v: string | null) => void }[] = [];

function pumpArt(): void {
  while (artActive < ART_CONCURRENCY && artQueue.length) {
    const next = artQueue.shift()!;
    if (next.gen >= 0 && next.gen !== warmGen) {
      // stale prefetch: abandoned before it ever hit the network.
      artInflight.delete(next.url);
      next.resolve(null);
      continue;
    }
    artActive++;
    void (async (): Promise<void> => {
      let result: string | null = null;
      try {
        const res = await getClient().net.fetch({
          request: { url: next.url, method: 'GET', headers: [], body: null, timeoutMs: 15000, redirect: 'follow' },
        });
        if (res.ok) {
          const r = res.response.response as { status: number; body?: Uint8Array };
          if (r.status < 400 && r.body?.length) {
            const bytes = new Uint8Array(r.body); // copy: BlobPart needs Uint8Array<ArrayBuffer>
            const obj = URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }));
            while (artObjects.size >= ART_CACHE_MAX) evictOldestArt();
            artObjects.set(next.url, obj);
            result = obj;
          }
        }
      } catch {
        // failed art just leaves the tile placeholder
      } finally {
        artActive--;
        artInflight.delete(next.url);
        next.resolve(result);
        pumpArt();
      }
    })();
  }
}

// Prefetch generation: bumped to abandon a prefetch batch (e.g. the user
// switched tabs before it drained) so stale prefetches don't clog the queue.
let warmGen = 0;

// Pre-fetch a batch of artwork urls (e.g. a freshly loaded rail) so the
// images are already cached when their tiles mount. Capped and funneled
// through the same concurrency gate as on-demand loads; prefetch batches are
// abandoned when cancelWarmArt() runs (their queued slots are skipped before
// ever hitting the network).
export function warmArt(srcs: (string | null | undefined)[], limit = 48): void {
  const gen = warmGen;
  let n = 0;
  for (const s of srcs) {
    if (n >= limit) break;
    if (s && !artObjects.has(s) && !artInflight.has(s)) {
      n++;
      const p = new Promise<string | null>(resolve => {
        artQueue.push({ url: s, gen, resolve });
        pumpArt();
      });
      artInflight.set(s, p);
      // Fire-and-forget: a Tile that mounts later picks the result up from
      // artInflight/artObjects. A skipped-stale prefetch resolves null and a
      // later demand load simply re-enqueues.
      void p.catch(() => {});
    }
  }
}

export function cancelWarmArt(): void {
  warmGen++;
}

export function useCachedArt(src: string | null): { url: string | null; failed: boolean } {
  const [obj, setObj] = useState<string | null>(() => (src ? (artObjects.get(src) ?? null) : null));
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!src) {
      setObj(null);
      setFailed(false);
      return;
    }
    let dead = false;
    setFailed(false);
    const hit = artObjects.get(src);
    if (hit) {
      setObj(hit);
      return;
    }
    setObj(null);
    void loadArt(src).then(o => {
      if (dead) return;
      if (o) setObj(o);
      else setFailed(true);
    });
    return () => {
      dead = true;
    };
  }, [src]);
  return { url: obj, failed };
}

// artwork resolution comes from the app, which owns the jellyfin client.
export interface ArtResolver {
  trackArt: (t: Track, w?: number) => string | null;
  albumArt: (a: Album, w?: number) => string | null;
  artistArt: (a: Artist, w?: number) => string | null;
  playlistArt: (p: Playlist, w?: number) => string | null;
}
export const ArtCtx = createContext<ArtResolver | null>(null);
export const useArt = (): ArtResolver | null => useContext(ArtCtx);

export function usePlayer(): number {
  return useSyncExternalStore(
    useCallback((fn: () => void) => player.subscribe(fn), []),
    () => player.revision,
  );
}

export function detectPortrait(): boolean {
  try {
    if (screen.orientation?.type.startsWith('portrait')) return true;
  } catch {
    // older webview
  }
  try {
    if (window.matchMedia('(orientation: portrait)').matches) return true;
  } catch {
    // no matchMedia
  }
  return false;
}

export function usePortrait(): boolean {
  const [p, setP] = useState(detectPortrait);
  useEffect(() => {
    const update = (): void => setP(detectPortrait());
    window.addEventListener('orientationchange', update);
    let mq: MediaQueryList | null = null;
    try {
      mq = window.matchMedia('(orientation: portrait)');
      mq.addEventListener('change', update);
    } catch {
      // ignore
    }
    return () => {
      window.removeEventListener('orientationchange', update);
      mq?.removeEventListener('change', update);
    };
  }, []);
  return p;
}

export function fmtTime(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ---- icons (inline svg, currentColor) ----

const PATHS: Record<string, string> = {
  play: 'M8 5v14l11-7z',
  pause: 'M6 5h4v14H6zM14 5h4v14h-4z',
  next: 'M6 6l8.5 6L6 18zM16 6h2v12h-2z',
  prev: 'M18 6l-8.5 6L18 18zM6 6h2v12H6z',
  heart: 'M12 21s-7.5-4.7-10-9.3C.4 8.6 2.4 5 5.8 5c2 0 3.4 1.1 4.2 2.3h4c.8-1.2 2.2-2.3 4.2-2.3 3.4 0 5.4 3.6 3.8 6.7C19.5 16.3 12 21 12 21z',
  heartFill:
    'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z',
  shuffle: 'M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.3 2.3-4.88 4.88 1.42 1.42L18.22 7.7 21 10.5V4h-6.5zm.5 13.5l-1.42 1.42L8.41 13.75 7 15.16l5.17 5.17 1.42-1.41L8.41 13.75l5.59-5.58 4.88 4.88 1.42-1.42-4.88-4.88z',
  repeat: 'M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z',
  repeatOne: 'M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4zm-4-6h-2v4h-2v-6h4v2z',
  search: 'M15.5 14h-.79l-.28-.27a6.5 6.5 0 1 0-.7.7l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0A4.5 4.5 0 1 1 14 9.5 4.5 4.5 0 0 1 9.5 14z',
  home: 'M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z',
  library: 'M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H8V4h12v12z',
  queue: 'M3 6h12v2H3zm0 4h12v2H3zm0 4h8v2H3zM16 9l6 3-6 3z',
  plus: 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z',
  x: 'M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
  back: 'M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z',
  dots: 'M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z',
  volUp: 'M3 9v6h4l5 5V4L7 9H3zm13.5 3a4.5 4.5 0 0 0-2.5-4.03v8.05A4.47 4.47 0 0 0 16.5 12z',
  volDown: 'M3 9v6h4l5 5V4L7 9H3z',
  mute: 'M16.5 12A4.5 4.5 0 0 0 14 8v2.18l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.8 8.8 0 0 0 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a8.99 8.99 0 0 0 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z',
  note: 'M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z',
  mix: 'M3 5h2v14H3zm5 0h2v14H5zm4 0h2v9H9zm5 0h2v14h-2zm4 0h2v5h-2z',
  check: 'M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z',
  clock: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 10.59l-4.24 4.25-1.42-1.42L11 11.76V6h1v6.59z',
  mic: 'M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.91-3c-.49 0-.9.36-.98.85C16.52 14.2 14.47 16 12 16s-4.52-1.8-4.93-4.15c-.08-.49-.49-.85-.98-.85-.61 0-1.09.54-1 1.14.49 3 2.89 5.35 5.91 5.78V20c0 .55.45 1 1 1s1-.45 1-1v-2.08c3.02-.43 5.42-2.78 5.91-5.78.1-.6-.39-1.14-1-1.14z',
};

export function Icon({ name, size = 28, className = '' }: { name: keyof typeof PATHS; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d={PATHS[name]} />
    </svg>
  );
}

// ---- artwork ----

export function Artwork({
  src,
  size,
  rounded = 'rounded-xl',
  label = '',
}: {
  src: string | null;
  size: number;
  rounded?: string;
  label?: string;
}) {
  const { url, failed } = useCachedArt(src);
  if (!src || failed || !url) {
    return (
      <div
        className={`flex shrink-0 items-center justify-center bg-white/8 text-white/25 ${rounded}`}
        style={{ width: size, height: size }}
        aria-label={label}
      >
        <Icon name="note" size={Math.round(size * 0.4)} />
      </div>
    );
  }
  return (
    <img
      src={url}
      width={size}
      height={size}
      draggable={false}
      className={`shrink-0 object-cover ${rounded}`}
      style={{ width: size, height: size }}
      alt={label}
    />
  );
}

// ---- buttons / chrome ----

export function IconBtn({
  onClick,
  label,
  children,
  size = 72,
  active = false,
  disabled = false,
}: {
  onClick: () => void;
  label: string;
  children: ReactNode;
  size?: number;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={e => {
        e.stopPropagation();
        onClick();
      }}
      className={`flex shrink-0 items-center justify-center rounded-full transition-colors ${
        active ? 'bg-leaf text-black' : 'text-white/85 active:bg-white/15'
      } ${disabled ? 'opacity-30' : ''}`}
      style={{ width: size, height: size }}
    >
      {children}
    </button>
  );
}

export function TopBar({ title, onBack, right }: { title: string; onBack?: () => void; right?: ReactNode }) {
  return (
    <div className="flex h-20 shrink-0 items-center gap-3 border-b border-white/10 px-4">
      {onBack ? (
        <IconBtn onClick={onBack} label="Back" size={56}>
          <Icon name="back" size={30} />
        </IconBtn>
      ) : null}
      <h1 className="min-w-0 flex-1 truncate text-2xl font-semibold">{title}</h1>
      {right}
    </div>
  );
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 text-white/50">
      <div className="h-12 w-12 animate-spin rounded-full border-4 border-white/15 border-t-gold" />
      <div className="text-xl">{label}</div>
    </div>
  );
}

export function Empty({ text }: { text: string }) {
  return <div className="flex flex-1 items-center justify-center px-8 text-center text-xl text-white/40">{text}</div>;
}

// Shown when the server rejected the credentials: the error text plus a way
// back to sign-in (Quick Connect / API key), since Setup is otherwise only
// reachable when no credentials exist at all.
export function AuthError({ text, onReconnect }: { text: string; onReconnect: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-5 px-8 text-center">
      <div className="text-xl leading-relaxed text-white/60">{text}</div>
      <button
        type="button"
        onClick={onReconnect}
        className="rounded-2xl bg-leaf px-8 py-4 text-xl font-bold text-black active:brightness-90"
      >
        Reconnect
      </button>
    </div>
  );
}

// ---- tiles & rows ----

export function Tile({
  title,
  subtitle,
  art,
  onClick,
  onMenu,
}: {
  title: string;
  subtitle?: string;
  art: string | null;
  onClick: () => void;
  onMenu?: () => void;
}) {
  return (
    <div className="relative w-40 shrink-0">
      <button type="button" onClick={onClick} className="block w-full text-left active:opacity-80">
        <Artwork src={art} size={160} label={title} />
        <div className="mt-2 truncate text-lg leading-tight font-medium">{title}</div>
        {subtitle ? <div className="truncate text-base leading-tight text-white/50">{subtitle}</div> : null}
      </button>
      {onMenu ? (
        <button
          type="button"
          aria-label={`More options for ${title}`}
          onClick={e => {
            e.stopPropagation();
            onMenu();
          }}
          className="absolute top-1 right-1 flex h-12 w-12 items-center justify-center rounded-full bg-black/60 text-white/90 active:bg-black/80"
        >
          <Icon name="dots" size={26} />
        </button>
      ) : null}
    </div>
  );
}

export function TrackRow({
  track,
  art,
  onPlay,
  onMenu,
  showArt = true,
  indexLabel,
}: {
  track: Track;
  art: string | null;
  onPlay: () => void;
  onMenu?: () => void;
  showArt?: boolean;
  indexLabel?: string;
}) {
  usePlayer();
  const active = player.current()?.id === track.id;
  return (
    <div
      className={`flex min-h-16 items-center gap-3 rounded-xl px-2 py-2 ${active ? 'bg-leaf/10' : 'active:bg-white/8'}`}
    >
      <button type="button" onClick={onPlay} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        {showArt ? (
          <Artwork src={art} size={56} rounded="rounded-lg" label={track.album} />
        ) : indexLabel ? (
          <span className="w-10 shrink-0 text-center text-xl text-white/40">{indexLabel}</span>
        ) : null}
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-xl leading-tight ${active ? 'text-leaf' : ''}`}>
            {track.name}
          </span>
          <span className="block truncate text-base leading-tight text-white/50">
            {track.artist} {track.album ? `· ${track.album}` : ''}
          </span>
        </span>
        <span className="shrink-0 text-base text-white/40">{fmtTime(track.durationMs)}</span>
      </button>
      <button
        type="button"
        aria-label={`Play ${track.name}`}
        onClick={onPlay}
        className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-white/70 active:bg-white/15"
      >
        <Icon name={active && player.intentPlaying ? 'pause' : 'play'} size={30} />
      </button>
      {onMenu ? (
        <button
          type="button"
          aria-label={`More options for ${track.name}`}
          onClick={onMenu}
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-white/70 active:bg-white/15"
        >
          <Icon name="dots" size={28} />
        </button>
      ) : null}
    </div>
  );
}

// ---- progress bar with tap/drag seek ----

export function ProgressBar({ onSeek }: { onSeek: (ms: number) => void }) {
  usePlayer();
  const barRef = useRef<HTMLDivElement>(null);
  const [, force] = useState(0);
  const dur = player.trackDurationMs;

  useEffect(() => {
    if (!player.intentPlaying) return;
    let raf = 0;
    const tick = (): void => {
      force(n => n + 1);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [player.intentPlaying]);

  const ratio = dur > 0 ? Math.min(1, Math.max(0, player.positionNow() / dur)) : 0;

  const seekFromEvent = (clientX: number): void => {
    const el = barRef.current;
    if (!el || dur <= 0) return;
    const r = el.getBoundingClientRect();
    const p = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    onSeek(p * dur);
  };

  return (
    <div className="w-full">
      <div
        ref={barRef}
        role="slider"
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={Math.round(dur)}
        aria-valuenow={Math.round(player.positionNow())}
        className="relative h-10 w-full cursor-pointer touch-none"
        onPointerDown={e => {
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          seekFromEvent(e.clientX);
        }}
        onPointerMove={e => {
          if (e.buttons) seekFromEvent(e.clientX);
        }}
      >
        <div className="absolute top-1/2 h-1.5 w-full -translate-y-1/2 rounded-full bg-white/15">
          <div className="h-full rounded-full bg-gold" style={{ width: `${ratio * 100}%` }} />
        </div>
        <div
          className="absolute top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-goldlight shadow"
          style={{ left: `${ratio * 100}%` }}
        />
      </div>
      <div className="flex justify-between text-lg text-white/55">
        <span>{fmtTime(player.positionNow())}</span>
        <span>-{fmtTime(Math.max(0, dur - player.positionNow()))}</span>
      </div>
    </div>
  );
}

// ---- context menu (bottom sheet) ----

export interface MenuAction {
  label: string;
  icon: keyof typeof PATHS;
  run: () => void;
  danger?: boolean;
}

export function MenuSheet({ title, actions, onClose }: { title: string; actions: MenuAction[]; onClose: () => void }) {
  return (
    <div className="absolute inset-0 z-50 flex items-end justify-center bg-black/70" onClick={onClose}>
      <div
        className="max-h-[85%] w-full overflow-y-auto rounded-t-3xl bg-zinc-900 p-4 pb-6"
        onClick={e => e.stopPropagation()}
      >
        <div className="mb-3 truncate px-2 text-2xl font-semibold">{title}</div>
        {actions.map(a => (
          <button
            key={a.label}
            type="button"
            onClick={() => {
              onClose();
              a.run();
            }}
            className={`mb-2 flex h-18 w-full items-center gap-4 rounded-2xl px-4 text-left text-2xl active:bg-white/10 ${
              a.danger ? 'text-red-400' : ''
            }`}
          >
            <Icon name={a.icon} size={30} />
            {a.label}
          </button>
        ))}
        <button
          type="button"
          onClick={onClose}
          className="mt-2 flex h-18 w-full items-center justify-center gap-3 rounded-2xl bg-white/10 text-2xl font-medium active:bg-white/20"
        >
          <Icon name="x" size={28} /> Cancel
        </button>
      </div>
    </div>
  );
}

export function useMenu() {
  const [menu, setMenu] = useState<{ title: string; actions: MenuAction[] } | null>(null);
  const sheet = menu ? <MenuSheet title={menu.title} actions={menu.actions} onClose={() => setMenu(null)} /> : null;
  return useMemo(() => ({ open: setMenu, sheet }), [sheet]);
}
