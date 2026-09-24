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
