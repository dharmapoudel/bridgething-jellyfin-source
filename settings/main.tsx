// Finch settings page. Runs on the PHONE inside the companion app, so it
// uses settings.fetch (the phone's network, no CORS) to talk to Jellyfin and
// settings.config.set to hand the credentials to the Car Thing.
import { settings } from '@bridgething/client/settings';
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

const APP_VERSION = '0.1.0';

type Status = { kind: 'ok' | 'err' | 'info'; text: string } | null;

function authHeader(deviceId: string): string {
  return `MediaBrowser Client="Finch", Device="Car Thing", DeviceId="${deviceId}", Version="${APP_VERSION}"`;
}

async function postJson(url: string, body: unknown, headers: Record<string, string> = {}): Promise<unknown> {
  const res = await settings.fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    timeoutMs: 20_000,
  });
  if (res.status === 401 || res.status === 403) throw new Error('rejected: check the username, password or API key.');
  if (!res.ok) throw new Error(`server error ${res.status}`);
  return res.json();
}

async function getJson(url: string): Promise<unknown> {
  const res = await settings.fetch(url, { timeoutMs: 20_000 });
  if (res.status === 401 || res.status === 403) throw new Error('rejected: check the API key.');
  if (!res.ok) throw new Error(`server error ${res.status}`);
  return res.json();
}

function Settings() {
  const [deviceId, setDeviceId] = useState('');
  const [server, setServer] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [savedFor, setSavedFor] = useState('');
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const ctx = await settings.context();
        setDeviceId(ctx.deviceId);
        const entries = await settings.config.list();
        const byKey = Object.fromEntries(entries.map(e => [e.key, e.value ?? '']));
        setServer(byKey['server_url'] ?? '');
        setApiKey(byKey['api_key'] ?? '');
        if (byKey['server_url']) setSavedFor(byKey['server_url']);
      } catch (e) {
        setStatus({ kind: 'err', text: e instanceof Error ? e.message : 'could not talk to the companion app' });
      }
    })();
  }, []);

  const cleanServer = (s: string): string => s.trim().replace(/\/+$/, '');

  async function saveAll(serverUrl: string, token: string, userId: string, userName: string): Promise<void> {
    await settings.config.set('server_url', serverUrl);
    await settings.config.set('api_key', token);
    await settings.config.set('user_id', userId);
    setSavedFor(`${userName} @ ${serverUrl}`);
  }

  async function connectWithPassword(): Promise<void> {
    const srv = cleanServer(server);
    if (!srv || !username.trim()) {
      setStatus({ kind: 'err', text: 'enter the server URL and your Jellyfin username first.' });
      return;
    }
    setBusy(true);
    setStatus({ kind: 'info', text: 'signing in…' });
    try {
      const data = (await postJson(
        `${srv}/Users/AuthenticateByName`,
        { Username: username.trim(), Pw: password },
        { Authorization: authHeader(deviceId || 'finch-settings') },
      )) as { AccessToken: string; User: { Id: string; Name: string } };
      if (!data.AccessToken) throw new Error('the server did not return a token.');
      await saveAll(srv, data.AccessToken, data.User.Id, data.User.Name);
      setStatus({ kind: 'ok', text: `signed in as ${data.User.Name}. Finch on the Car Thing will pick this up.` });
    } catch (e) {
      setStatus({ kind: 'err', text: e instanceof Error ? e.message : 'sign-in failed.' });
    } finally {
      setBusy(false);
    }
  }

  async function connectWithKey(): Promise<void> {
    const srv = cleanServer(server);
    const key = apiKey.trim();
    if (!srv || !key) {
      setStatus({ kind: 'err', text: 'enter the server URL and an API key first.' });
      return;
    }
    setBusy(true);
    setStatus({ kind: 'info', text: 'testing the API key…' });
    try {
      await getJson(`${srv}/System/Info?api_key=${encodeURIComponent(key)}`);
      const users = (await getJson(`${srv}/Users?api_key=${encodeURIComponent(key)}`)) as {
        Id: string;
        Name: string;
      }[];
      if (!users.length) throw new Error('the server returned no users.');
      await saveAll(srv, key, users[0].Id, users[0].Name);
      setStatus({ kind: 'ok', text: `API key works (user: ${users[0].Name}). Finch on the Car Thing will pick this up.` });
    } catch (e) {
      setStatus({ kind: 'err', text: e instanceof Error ? e.message : 'connection failed.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <h1>Finch settings</h1>
      <p className="hint">Connect Finch to your Jellyfin server. The Car Thing reads these credentials.</p>
      {savedFor ? <div className="saved">currently saved: {savedFor}</div> : null}

      <section>
        <h2>Server</h2>
        <label htmlFor="server">Jellyfin server URL</label>
        <input
          id="server"
          value={server}
          onChange={e => setServer(e.target.value)}
          placeholder="https://jellyfin.example.com"
          inputMode="url"
          autoCapitalize="off"
          autoCorrect="off"
        />
      </section>

      <section>
        <h2>Sign in with username &amp; password</h2>
        <label htmlFor="username">Username</label>
        <input id="username" value={username} onChange={e => setUsername(e.target.value)} autoCapitalize="off" autoCorrect="off" />
        <label htmlFor="password">Password</label>
        <input id="password" type="password" value={password} onChange={e => setPassword(e.target.value)} />
        <button type="button" className="primary" disabled={busy} onClick={connectWithPassword}>
          Connect
        </button>
      </section>

      <section>
        <h2>Or paste an API key</h2>
        <p className="hint">From the Jellyfin dashboard under API Keys. The server URL above still applies.</p>
        <label htmlFor="apikey">API key</label>
        <input id="apikey" value={apiKey} onChange={e => setApiKey(e.target.value)} autoCapitalize="off" autoCorrect="off" />
        <button type="button" className="primary" disabled={busy} onClick={connectWithKey}>
          Test &amp; save
        </button>
      </section>

      {status ? <div className={`status ${status.kind}`}>{status.text}</div> : null}
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<Settings />);
