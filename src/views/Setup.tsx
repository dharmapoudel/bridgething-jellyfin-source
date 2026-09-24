import { useEffect, useRef, useState } from 'react';
import { getClient } from '../client';
import { Icon, Keyboard, TopBar } from '../components';
import { quickConnectAuthenticate, quickConnectInitiate, quickConnectPoll, testConnection } from '../jellyfin';
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

type Mode = 'key' | 'quick';

export default function Setup({ onSaved }: ViewProps & { onSaved: () => void }) {
  const [server, setServer] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [mode, setMode] = useState<Mode>('quick');
  const [field, setField] = useState<'server' | 'key'>('server');
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

  useEffect(() => stopPoll, []);

  const saveWithKey = async (): Promise<void> => {
    if (!server.trim() || !apiKey.trim()) {
      setStatus('Enter the server URL and an API key first.');
      return;
    }
    setBusy(true);
    setStatus('Testing the connection…');
    try {
      const { userId, userName } = await testConnection(server, apiKey);
      await saveCredsToStore({ server: server.trim(), apiKey: apiKey.trim(), userId, userName });
      setStatus(null);
      onSaved();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Connection failed.');
    } finally {
      setBusy(false);
    }
  };

  const qcFail = (e: unknown): string => {
    const msg = e instanceof Error ? e.message : 'Quick Connect failed.';
    if (/\b404\b/.test(msg)) {
      return 'This server does not support Quick Connect (needs Jellyfin 10.8+ with Quick Connect enabled). Use the API key instead.';
    }
    return msg;
  };

  const startQuickConnect = async (): Promise<void> => {
    if (!server.trim()) {
      setStatus('Enter the server URL first.');
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
              await saveCredsToStore({ server: server.trim(), apiKey: token, userId, userName });
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
        </div>

        <div className="mb-5 flex rounded-2xl bg-white/8 p-1.5">
          {(
            [
              ['quick', 'Quick Connect'],
              ['key', 'API key'],
            ] as [Mode, string][]
          ).map(([m, label]) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                cancelQuickConnect();
                setMode(m);
              }}
              className={`flex-1 rounded-xl py-3 text-xl font-semibold ${
                mode === m ? 'bg-amber-400 text-black' : 'text-white/60 active:bg-white/10'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setField('server')}
          className={`mb-3 block w-full rounded-2xl border-2 p-4 text-left ${
            field === 'server' ? 'border-amber-400' : 'border-transparent bg-white/8'
          }`}
        >
          <div className="text-lg text-white/50">Server URL</div>
          <div className="truncate text-2xl">{server || <span className="text-white/30">https://… or http://192.168.1.10:8096</span>}</div>
        </button>

        {mode === 'key' ? (
          <button
            type="button"
            onClick={() => setField('key')}
            className={`mb-4 block w-full rounded-2xl border-2 p-4 text-left ${
              field === 'key' ? 'border-amber-400' : 'border-transparent bg-white/8'
            }`}
          >
            <div className="text-lg text-white/50">API key</div>
            <div className="truncate text-2xl">{apiKey ? '•'.repeat(Math.min(apiKey.length, 24)) : <span className="text-white/30">paste your API key</span>}</div>
          </button>
        ) : null}

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

        {mode === 'quick' ? (
          qcCode ? (
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
              disabled={busy}
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
          )
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={saveWithKey}
            className="flex h-20 w-full items-center justify-center gap-3 rounded-2xl bg-amber-400 text-2xl font-bold text-black active:bg-amber-300 disabled:opacity-50"
          >
            {busy ? (
              <span className="h-8 w-8 animate-spin rounded-full border-4 border-black/20 border-t-black" />
            ) : (
              <Icon name="check" size={30} />
            )}
            Test &amp; save
          </button>
        )}

        {mode === 'key' ? (
          <div className="mt-4 text-center text-lg text-white/40">
            You need an API key from the Jellyfin dashboard (Dashboard → API Keys).
          </div>
        ) : null}
      </div>
      <Keyboard
        value={field === 'server' ? server : apiKey}
        onChange={field === 'server' ? setServer : setApiKey}
        onDone={mode === 'key' ? saveWithKey : startQuickConnect}
      />
    </div>
  );
}
