import { useEffect, useState } from 'react';
import { Icon, usePlayer } from './components';
import { player } from './player';
import type { RemoteSessionInfo } from './remote';

// "Play on" picker: this device (the companion app, the default path) or a
// Finamp session on the phone, which Finch then remote-controls through the
// Jellyfin server while Finamp's own player does the audio.
export function RemoteSheet({ onClose }: { onClose: () => void }) {
  usePlayer();
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [sessions, setSessions] = useState<RemoteSessionInfo[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let stale = false;
    player
      .discoverRemote()
      .then(
        list => {
          if (!stale) {
            setSessions(list);
            setState('ready');
          }
        },
        () => {
          if (!stale) setState('error');
        },
      );
    return () => {
      stale = true;
    };
  }, []);

  const choose = (s: RemoteSessionInfo): void => {
    if (busy) return;
    setBusy(true);
    void player.enableRemote(s.id, s.deviceName).then(
      () => onClose(),
      () => setBusy(false),
    );
  };

  const row =
    'flex w-full items-center gap-4 rounded-2xl px-4 py-4 text-left active:bg-white/10';

  return (
    <div className="absolute inset-0 z-30">
      <button
        type="button"
        aria-label="Close device picker"
        onClick={onClose}
        className="absolute inset-0 bg-black/50"
      />
      <div className="absolute inset-x-0 bottom-0 top-[25%] flex flex-col overflow-hidden rounded-t-3xl bg-[#171a21]/95 shadow-2xl backdrop-blur-xl">
        <div className="flex shrink-0 items-center justify-between px-6 py-5">
          <div className="text-2xl font-bold">Play on</div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="grid h-12 w-12 place-items-center rounded-full text-white/60 active:bg-white/10"
          >
            <Icon name="x" size={28} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-8">
          <button type="button" onClick={() => { player.disableRemote(); onClose(); }} className={row}>
            <Icon name="note" size={30} className="shrink-0 text-white/60" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-xl font-semibold">This device</div>
              <div className="truncate text-lg text-white/45">Companion app audio</div>
            </div>
            {!player.remoteActive ? <Icon name="check" size={26} className="shrink-0 text-leaf" /> : null}
          </button>
          {state === 'loading' ? (
            <div className="flex items-center justify-center py-10">
              <div className="h-10 w-10 animate-spin rounded-full border-4 border-white/15 border-t-gold" />
            </div>
          ) : state === 'error' ? (
            <div className="px-4 py-6 text-center text-xl text-white/50">
              Could not reach the server.
            </div>
          ) : sessions.length === 0 ? (
            <div className="px-4 py-6 text-center text-xl leading-snug text-white/50">
              No Finamp sessions found. Open Finamp on your phone (signed into the same Jellyfin
              user) and try again.
            </div>
          ) : (
            sessions.map(s => (
              <button key={s.id} type="button" onClick={() => choose(s)} className={row}>
                <Icon name="note" size={30} className="shrink-0 text-white/60" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xl font-semibold">
                    Finamp <span className="font-normal text-white/45">· {s.deviceName}</span>
                  </div>
                  <div className="truncate text-lg text-white/45">
                    {s.nowPlayingName ?? (s.isPlaying ? 'Playing' : 'Idle')}
                  </div>
                </div>
                {player.remoteActive && player.remoteSessionId === s.id ? (
                  <Icon name="check" size={26} className="shrink-0 text-leaf" />
                ) : null}
              </button>
            ))
          )}
          <div className="px-4 pt-4 text-lg leading-snug text-white/35">
            While a Finamp session is selected, audio plays in Finamp and Finch is only the remote —
            transport, seek and queue all drive the phone's own player.
          </div>
        </div>
      </div>
    </div>
  );
}
