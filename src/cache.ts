// tiny in-memory cache so tab switches and back-nav feel instant.
const TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; data: unknown }>();

export async function cached<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data as T;
  const data = await fetcher();
  cache.set(key, { at: Date.now(), data });
  if (cache.size > 60) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) cache.delete(oldest[0]);
  }
  return data;
}

export function bust(keyPrefix: string): void {
  for (const k of [...cache.keys()]) if (k.startsWith(keyPrefix)) cache.delete(k);
}

// ---- full clear (the Settings "Clear cached data" button) ----
// Drops everything: the in-memory API cache, the sticky localStorage tier,
// and (via clearArtCache in components.tsx) both artwork tiers.
export function bustAll(): void {
  cache.clear();
}

export function stickyBustAll(): void {
  const store = ls();
  if (!store) return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (k && k.startsWith(STICKY_PREFIX)) keys.push(k);
    }
    for (const k of keys) store.removeItem(k);
  } catch {
    // ignore
  }
}

// ---- persistent sticky cache (cold-start loader) ----
// localStorage-backed: survives app restarts, so a cold start paints the last
// known library instantly instead of spinning on the network. Views seed from
// it synchronously, then revalidate in the background and overwrite on success.
// Stale data beats a spinner; the background refresh keeps it honest.
const STICKY_PREFIX = 'finch:sticky:';

function ls(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export function stickyGet<T>(key: string): T | null {
  const store = ls();
  if (!store) return null;
  try {
    const raw = store.getItem(STICKY_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { data: unknown };
    return parsed.data as T;
  } catch {
    return null;
  }
}

export function stickySet(key: string, data: unknown): void {
  const store = ls();
  if (!store) return;
  try {
    store.setItem(STICKY_PREFIX + key, JSON.stringify({ at: Date.now(), data }));
  } catch {
    // quota or unavailable: the in-memory cache still covers this session.
  }
}

export function stickyBust(keyPrefix: string): void {
  const store = ls();
  if (!store) return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (k && k.startsWith(STICKY_PREFIX + keyPrefix)) keys.push(k);
    }
    for (const k of keys) store.removeItem(k);
  } catch {
    // ignore
  }
}
