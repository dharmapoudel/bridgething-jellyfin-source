import type { Playlist } from './jellyfin';

// Playlists the user has actually played in Finch, most recent first.
// Jellyfin doesn't report playlist-level play history, so Finch records
// each playlist play locally (capped, deduped).
export interface RecentPlaylist {
  id: string;
  name: string;
  songCount: number;
  imageTag: string | null;
  playedAt: number;
}

const KEY = 'finch:recent-playlists';
const MAX = 20;

function store(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export function recordPlaylistPlay(p: Pick<Playlist, 'id' | 'name' | 'songCount' | 'imageTag'>): void {
  const s = store();
  if (!s) return;
  let list: RecentPlaylist[] = [];
  try {
    const raw = JSON.parse(s.getItem(KEY) ?? '[]') as RecentPlaylist[];
    if (Array.isArray(raw)) list = raw;
  } catch {
    list = [];
  }
  list = list.filter(e => e && e.id !== p.id);
  list.unshift({
    id: p.id,
    name: p.name,
    songCount: p.songCount,
    imageTag: p.imageTag ?? null,
    playedAt: Date.now(),
  });
  try {
    s.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  } catch {
    // storage full or unavailable: recent list just stays as-is
  }
}

export function getRecentPlaylists(): RecentPlaylist[] {
  const s = store();
  if (!s) return [];
  try {
    const raw = JSON.parse(s.getItem(KEY) ?? '[]') as RecentPlaylist[];
    return Array.isArray(raw) ? raw.filter(e => e && typeof e.id === 'string') : [];
  } catch {
    return [];
  }
}
