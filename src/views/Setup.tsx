import { useEffect, useRef, useState } from 'react';
import { getClient } from '../client';
import { Icon, TopBar } from '../components';
import { quickConnectAuthenticate, quickConnectInitiate, quickConnectPoll } from '../jellyfin';
import type { ViewProps } from '../nav';

export const CREDS_KEY = 'finch:creds';

export interface StoredCreds {
  server: string;
  apiKey: string;
  userId: string;
  userName: string;
  ts: number; // when these creds were saved — newest source wins in readCreds
}

export async function saveCredsToStore(c: Omit<StoredCreds, 'ts'>): Promise<void> {
  const withTs: StoredCreds = { ...c, ts: Date.now() };
  await getClient().store.put({ key: CREDS_KEY, value: JSON.stringify(withTs) });
}

// On-device sign-in is Quick Connect only — there is no keyboard on the Car
// Thing, so the server URL comes from the phone's Finch settings and the
// sign-in itself is just a code to approve in Jellyfin. API-key entry lives
// on the phone settings page.
export default function Setup({ onSaved }: ViewProps & { onSaved: () => void }) {
  const [server, setServer] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [qcCode, setQcCode] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);

  const stopPoll = (): void => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  useEffect(() => {
    const client = getClient();
    client.config
      .get({ key: 'server_url' })
      .then(r => setServer(r.ok && r.response.value ? r.response.value : ''))
      .catch(() => setServer(''));
    return stopPoll;
  }, []);

  const qcFail = (e: unknown): string => {
    const msg = e instanceof Error ? e.message : 'Quick Connect failed.';
    if (/\b404\b/.test(msg)) {
      return 'This server does not support Quick Connect (needs Jellyfin 10.8+ with Quick Connect enabled).';
    }
    return msg;
  };

  const startQuickConnect = async (): Promise<void> => {
    if (!server) {
      setStatus('Enter the server URL in the Finch settings on your phone first.');
      return;
    }
    setBusy(true);
    setStatus('Asking Jellyfin for a code…');
    try {
      const session = await quickConnectInitiate(server);
      setQcCode(session.code);
      setStatus('Enter this code in Jellyfin to link Finch.');
      setBusy(false);
      // poll until approved (or the user cancels)
      let tries = 0;
      stopPoll();
      pollRef.current = window.setInterval(() => {
        void (async () => {
          tries += 1;
          try {
            if (await quickConnectPoll(server, session.secret)) {
              stopPoll();
              setStatus('Code approved — finishing sign-in…');
              const { apiKey: token, userId, userName } = await quickConnectAuthenticate(server, session.secret);
              await saveCredsToStore({ server, apiKey: token, userId, userName });
              setQcCode(null);
              setStatus(null);
              onSaved();
            } else if (tries >= 100) {
              stopPoll();
              setQcCode(null);
              setStatus('Timed out waiting. Tap “Get a code” to try again.');
            }
          } catch (e) {
            stopPoll();
            setQcCode(null);
            setStatus(qcFail(e));
          }
        })();
      }, 3000);
    } catch (e) {
      setBusy(false);
      setStatus(qcFail(e));
    }
  };

  const cancelQuickConnect = (): void => {
    stopPoll();
    setQcCode(null);
    setBusy(false);
    setStatus(null);
  };

  return (
    <div className="flex h-full flex-col">
      <TopBar title="Connect to Jellyfin" />
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        <div className="mb-6 rounded-2xl bg-white/8 p-5 text-xl leading-relaxed text-white/75">
          The easy way: open the <span className="font-semibold text-white">Finch settings</span> in the companion
          app on your phone and sign in there — Finch picks it up automatically.
          <div className="mt-3 text-white/50">
            Or link right here: enter the server URL in the phone settings once, then get a code below and approve
            it in Jellyfin.
          </div>
        </div>

        <div className="mb-4 rounded-2xl bg-white/8 p-4">
          <div className="text-lg text-white/50">Server URL (from the phone settings)</div>
          <div className="truncate text-2xl">
            {server === null ? (
              <span className="text-white/30">loading…</span>
            ) : server ? (
              server
            ) : (
              <span className="text-white/30">not set — enter it on your phone</span>
            )}
          </div>
        </div>

        {qcCode ? (
          <div className="mb-4 rounded-2xl bg-white/8 p-5 text-center">
            <div className="mb-2 text-lg text-white/60">Enter this code in Jellyfin</div>
            <div className="mb-3 text-6xl font-bold tracking-[0.3em] text-amber-300">{qcCode}</div>
            <div className="text-lg leading-relaxed text-white/60">
              In Jellyfin, open your user menu → Quick Connect (or a Jellyfin app's settings → Quick Connect),
              type the code, and approve it.
            </div>
            <div className="mt-3 flex items-center justify-center gap-2 text-lg text-white/50">
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/20 border-t-white/70" />
              Waiting for approval…
            </div>
          </div>
        ) : null}

        {status ? (
          <div className="mb-4 rounded-2xl bg-white/8 px-4 py-3 text-xl text-white/80">{status}</div>
        ) : null}

        {qcCode ? (
          <button
            type="button"
            onClick={cancelQuickConnect}
            className="flex h-20 w-full items-center justify-center gap-3 rounded-2xl bg-white/10 text-2xl font-bold text-white active:bg-white/20"
          >
            Cancel
          </button>
        ) : (
          <button
            type="button"
            disabled={busy || !server}
            onClick={startQuickConnect}
            className="flex h-20 w-full items-center justify-center gap-3 rounded-2xl bg-amber-400 text-2xl font-bold text-black active:bg-amber-300 disabled:opacity-50"
          >
            {busy ? (
              <span className="h-8 w-8 animate-spin rounded-full border-4 border-black/20 border-t-black" />
            ) : (
              <Icon name="check" size={30} />
            )}
            Get a code
          </button>
        )}
      </div>
    </div>
  );
}
