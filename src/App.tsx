import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getClient } from './client';
import { ArtCtx, Icon, useMenu, usePlayer, usePortrait, type ArtResolver, type MenuAction } from './components';
import { JellyfinClient, type Creds } from './jellyfin';
import { player } from './player';
import type { View } from './nav';
import Detail from './views/Detail';
import Home from './views/Home';
import Library from './views/Library';
import NowPlaying from './views/NowPlaying';
import { QueueHandle, QueueSheet } from './QueueSheet';
import Queue from './views/Queue';
import Setup, { CREDS_KEY, type StoredCreds } from './views/Setup';

const NAV_ITEMS: { view: View; icon: 'home' | 'library' | 'search' | 'queue' | 'note'; label: string }[] = [
  { view: { name: 'home' }, icon: 'home', label: 'Home' },
  { view: { name: 'library', tab: 'albums' }, icon: 'library', label: 'Library' },
  { view: { name: 'queue' }, icon: 'queue', label: 'Queue' },
];

async function readCreds(): Promise<Creds | null> {
  const client = getClient();
  const get = async (key: string): Promise<string | null> => {
    try {
      const r = await client.config.get({ key });
      return r.ok ? (r.response.value ?? null) : null;
    } catch {
      return null;
    }
  };
  // Two sources can hold credentials: the phone's config (written by the
  // settings page) and the device store (written by on-device Quick Connect
  // / API-key setup). The newest sign-in wins; a newer-but-empty source
  // means "signed out" and beats an older valid one.
  const server = await get('server_url');
  const apiKey = await get('api_key');
  const userId = await get('user_id');
  const configTs = Number((await get('creds_ts')) ?? 0) || 0;
  const configValid = !!(server && apiKey && userId);

  let storeCreds: StoredCreds | null = null;
  try {
    const r = await client.store.get({ key: CREDS_KEY });
    if (r.ok && r.response.value) {
      const s = JSON.parse(r.response.value) as StoredCreds;
      if (s.server && s.apiKey && s.userId) storeCreds = s;
    }
  } catch {
    // ignore
  }
  const storeTs = storeCreds?.ts ?? 0;

  if (storeTs > configTs && storeCreds) {
    return { server: storeCreds.server, apiKey: storeCreds.apiKey, userId: storeCreds.userId };
  }
  if (configValid) return { server: server!, apiKey: apiKey!, userId: userId! };
  return null;
}

export default function App() {
  const [credsState, setCredsState] = useState<'loading' | 'missing' | 'ready'>('loading');
  const [jf, setJf] = useState<JellyfinClient | null>(null);
  const [stack, setStack] = useState<View[]>([{ name: 'home' }]);
  const [queueOpen, setQueueOpen] = useState(false);
  const [daemonUp, setDaemonUp] = useState(true);
  const menu = useMenu();
  usePlayer();
  const portrait = usePortrait();

  const view = stack[stack.length - 1];
  const viewRef = useRef(view);
  viewRef.current = view;
  // Where Now Playing was opened from; it minimizes back here
  // (its nav replaces the stack, so back() can't).
  const returnViewRef = useRef<View>({ name: 'home' });

  const load = useCallback(async () => {
    setCredsState('loading');
    const c = await readCreds();
    if (!c) {
      setJf(null);
      player.configure(null);
      setCredsState('missing');
      return;
    }
    const client = new JellyfinClient(c);
    player.configure(client);
    await player.ensureDeviceId();
    await player.loadPrefs();
    setJf(client);
    setCredsState('ready');
    // If something is already playing from the server (app was restarted
    // while the phone kept playing, or a session is active), adopt it so the
    // UI shows the true now-playing status instead of an empty player.
    void player.reconcileOnResume();
  }, []);

  // daemon link + player/volume subscriptions, once
  useEffect(() => {
    const client = getClient();
    const offLink = client.on(e => setDaemonUp(e.type !== 'close'));
    const offSnap = client.player.onSnapshot(reply => {
      const st = reply.state;
      player.handleSnapshot({
        context: st.context ? { uri: st.context.uri } : null,
        playback: { state: st.playback.state, positionMs: st.playback.positionMs },
      });
    });
    const offErrReply = client.player.onErrorReply(reply => player.handlePlayerError(reply.error.type));
    const offErrEvent = client.player.onErrorEvent(reply => player.handlePlayerError(reply.error.type));
    const offVol = client.audio.onVolumeChanged(msg => {
      player.volume = msg.level;
      player.muted = msg.muted;
      player.touch();
    });
    const offCfg = client.config.onChanged(() => {
      void load();
    });
    // prime from the phone's current state
    client.player
      .stateGet()
      .then(res => {
        if (res.ok) {
          const st = res.response.state;
          player.handleSnapshot({
            context: st.context ? { uri: st.context.uri } : null,
            playback: { state: st.playback.state, positionMs: st.playback.positionMs },
          });
        }
      })
      .catch(() => {});
    void load();
    return () => {
      offLink();
      offSnap();
      offErrReply();
      offErrEvent();
      offVol();
      offCfg();
    };
  }, [load]);

  const nav = useCallback((v: View) => {
    // bottom-nav destinations replace the stack; drill-ins push
    const cur = viewRef.current;
    // The stack is replaced (not pushed) when opening Now Playing, so
    // remember where it was opened from to minimize back to it.
    if (
      v.name === 'nowplaying' &&
      cur.name !== 'nowplaying' &&
      (cur.name === 'home' || cur.name === 'library' || cur.name === 'queue')
    ) {
      returnViewRef.current = cur;
    }
    const isRoot = v.name === 'home' || v.name === 'library' || v.name === 'queue' || v.name === 'nowplaying';
    setStack(prev => (isRoot ? [v] : [...prev, v]));
  }, []);

  const minimizeNowPlaying = useCallback(() => {
    nav(returnViewRef.current);
  }, [nav]);

  const back = useCallback(() => {
    setStack(prev => (prev.length > 1 ? prev.slice(0, -1) : prev));
  }, []);

  const openMenu = useCallback(
    (title: string, actions: MenuAction[]) => menu.open({ title, actions }),
    [menu],
  );

  // knob volume: relative steps only; leading-edge throttle with trailing flush
  const lastNudge = useRef(0);
  const pendingDir = useRef<0 | 1 | -1>(0);
  const nudgeTimer = useRef<number | null>(null);
  const nudgeVolume = useCallback((dir: 1 | -1) => {
    const fire = (d: 1 | -1): void => {
      const c = getClient();
      if (d > 0) c.audio.volumeUp().catch(() => {});
      else c.audio.volumeDown().catch(() => {});
    };
    const now = Date.now();
    if (now - lastNudge.current >= 90) {
      lastNudge.current = now;
      fire(dir);
    } else {
      pendingDir.current = dir;
      if (nudgeTimer.current === null) {
        nudgeTimer.current = window.setTimeout(() => {
          nudgeTimer.current = null;
          const d = pendingDir.current;
          pendingDir.current = 0;
          if (d !== 0) {
            lastNudge.current = Date.now();
            fire(d);
          }
        }, 90);
      }
    }
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const v = viewRef.current;
      if (e.key === 'Escape') {
        // Now Playing has no stack history (its nav replaced the stack),
        // so Escape minimizes it instead of popping.
        if (v.name === 'nowplaying') minimizeNowPlaying();
        else back();
        return;
      }
      if (e.key === 'm' || e.key === 'M') {
        // M is the device's home key: go to Finch home, never toggle playback.
        if (v.name !== 'setup') nav({ name: 'home' });
        return;
      }
      // preset shortcuts, ignored while typing in the on-screen keyboard views
      if (v.name === 'setup') return;
      if (e.key === '1') nav({ name: 'home' });
      else if (e.key === '2') nav({ name: 'library', tab: 'albums' });
      else if (e.key === '4') nav({ name: 'nowplaying' });
    };
    const onWheel = (e: WheelEvent): void => {
      if (Math.abs(e.deltaX) < Math.abs(e.deltaY)) return;
      if (e.deltaX === 0) return;
      e.preventDefault();
      nudgeVolume(e.deltaX > 0 ? 1 : -1);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('wheel', onWheel);
    };
  }, [back, minimizeNowPlaying, nav, nudgeVolume]);

  const artResolver: ArtResolver | null = useMemo(
    () =>
      jf
        ? {
            // list/grid thumbs render at 56-160px: 300px source is plenty.
            trackArt: (t, w = 300) => jf.trackImage(t, w),
            albumArt: (a, w = 300) => (a.imageTag ? jf.imageUrl(a.id, w) : null),
            artistArt: (a, w = 300) => (a.imageTag ? jf.imageUrl(a.id, w) : null),
            playlistArt: (p, w = 300) => (p.imageTag ? jf.imageUrl(p.id, w) : null),
          }
        : null,
    [jf],
  );

  const renderView = (): React.ReactNode => {
    if (credsState === 'loading') {
      return (
        <div className="flex h-full items-center justify-center">
          <div className="h-12 w-12 animate-spin rounded-full border-4 border-white/15 border-t-gold" />
        </div>
      );
    }
    if (credsState === 'missing' || !jf) {
      return <Setup jf={jf as never} nav={nav} back={back} openMenu={openMenu} onSaved={() => void load()} />;
    }
    const props = { jf, nav, back, openMenu };
    switch (view.name) {
      case 'home':
        return <Home {...props} />;
      case 'library':
        return <Library {...props} initialTab={view.tab} />;
      case 'detail':
        return <Detail {...props} params={view} />;
      case 'queue':
        return <Queue {...props} />;
      case 'nowplaying':
        return <NowPlaying {...props} onMinimize={minimizeNowPlaying} />;
      case 'setup':
        return <Setup {...props} onSaved={() => void load()} />;
    }
  };

  const showChrome = credsState === 'ready' && view.name !== 'nowplaying';
  const current = player.current();

  return (
    <ArtCtx.Provider value={artResolver}>
      <div className="relative flex h-full w-full flex-col bg-zinc-950 text-white">
        {!daemonUp ? (
          <div className="flex h-12 shrink-0 items-center justify-center bg-red-900/80 text-lg">
            Lost connection to the device. Reconnect to continue.
          </div>
        ) : null}
        <div className="relative min-h-0 flex-1">{renderView()}</div>
        {/* Queue bar on every screen while a song is playing; the mini player is gone. */}
        {current ? <QueueHandle onOpen={() => setQueueOpen(true)} /> : null}
        {queueOpen ? <QueueSheet onClose={() => setQueueOpen(false)} /> : null}
        {showChrome ? (
          // In portrait the physical knob overlaps the bottom-right corner, so
          // the nav floats above it instead of sitting flush at the bottom.
          <nav className={`flex h-20 shrink-0 items-stretch border-t border-white/10 bg-zinc-950 ${portrait ? 'mb-14' : ''}`}>
            {NAV_ITEMS.map(item => {
              const active =
                view.name === item.view.name ||
                (item.view.name === 'library' && view.name === 'library');
              return (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => nav(item.view)}
                  className={`flex flex-1 flex-col items-center justify-center gap-1 ${
                    active ? 'text-leaf' : 'text-white/55 active:bg-white/10'
                  }`}
                >
                  <Icon name={item.icon} size={30} />
                  <span className="text-base leading-none">{item.label}</span>
                </button>
              );
            })}
          </nav>
        ) : null}
        {menu.sheet}
      </div>
    </ArtCtx.Provider>
  );
}
