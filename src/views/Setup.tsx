import { useState } from 'react';
import { getClient } from '../client';
import { Icon, Keyboard, TopBar } from '../components';
import { testConnection } from '../jellyfin';
import type { ViewProps } from '../nav';

export const CREDS_KEY = 'finch:creds';

export interface StoredCreds {
  server: string;
  apiKey: string;
  userId: string;
  userName: string;
}

export async function saveCredsToStore(c: StoredCreds): Promise<void> {
  await getClient().store.put({ key: CREDS_KEY, value: JSON.stringify(c) });
}

export default function Setup({ onSaved }: ViewProps & { onSaved: () => void }) {
  const [server, setServer] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [field, setField] = useState<'server' | 'key'>('server');
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (): Promise<void> => {
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

  return (
    <div className="flex h-full flex-col">
      <TopBar title="Connect to Jellyfin" />
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        <div className="mb-6 rounded-2xl bg-white/8 p-5 text-xl leading-relaxed text-white/75">
          The easy way: open the <span className="font-semibold text-white">Finch settings</span> in the companion
          app on your phone and sign in there — Finch picks it up automatically.
          <div className="mt-3 text-white/50">
            Or enter the details below right here on the device. You need an API key from the Jellyfin dashboard
            (Dashboard → API Keys).
          </div>
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

        {status ? (
          <div className="mb-4 rounded-2xl bg-white/8 px-4 py-3 text-xl text-white/80">{status}</div>
        ) : null}

        <button
          type="button"
          disabled={busy}
          onClick={save}
          className="flex h-20 w-full items-center justify-center gap-3 rounded-2xl bg-amber-400 text-2xl font-bold text-black active:bg-amber-300 disabled:opacity-50"
        >
          {busy ? (
            <span className="h-8 w-8 animate-spin rounded-full border-4 border-black/20 border-t-black" />
          ) : (
            <Icon name="check" size={30} />
          )}
          Test &amp; save
        </button>
      </div>
      <Keyboard
        value={field === 'server' ? server : apiKey}
        onChange={field === 'server' ? setServer : setApiKey}
        onDone={save}
      />
    </div>
  );
}
