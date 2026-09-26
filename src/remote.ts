// Finamp remote control. Jellyfin's server API lets one client drive another
// client's session (the same mechanism as "Play on" in Jellyfin Web), and
// Finamp implements the receiving end — its PlayOn websocket service, on by
// default — obeying Pause/Unpause/NextTrack/PreviousTrack/Seek/Stop and Play
// commands. In remote mode Finch is only the remote: audio, queue,
// lock-screen metadata and offline downloads all live in Finamp, so none of
// the companion's flakiness touches playback. The remote track is mirrored
// into the player's queue/index/clock so every view works unchanged.

import { JellyfinClient, type RawSession, type Track } from './jellyfin';

export interface RemoteSessionInfo {
  id: string;
  deviceName: string;
  nowPlayingName: string | null;
  isPlaying: boolean;
}

export type RemoteCommand = 'Pause' | 'Unpause' | 'NextTrack' | 'PreviousTrack' | 'Seek' | 'Stop';

export interface RemoteState {
  track: Track | null;
  positionMs: number;
  paused: boolean;
  deviceName: string;
}

function normalizeRemoteTrack(raw: NonNullable<RawSession['NowPlayingItem']>): Track {
  return {
    id: raw.Id,
    name: raw.Name ?? 'Unknown track',
    albumId: raw.AlbumId ?? null,
    album: raw.Album ?? '',
    artist: (raw.Artists ?? []).join(', '),
    durationMs: Math.round((raw.RunTimeTicks ?? 0) / 10_000),
    isFavorite: raw.UserData?.IsFavorite ?? false,
    playCount: 0,
    imageTag: raw.ImageTags?.Primary ?? raw.AlbumPrimaryImageTag ?? null,
    albumImageTag: raw.AlbumPrimaryImageTag ?? null,
  };
}

export class FinampRemote {
  constructor(private jf: JellyfinClient) {}

  /** Finamp sessions this Jellyfin user can drive. */
  async discover(): Promise<RemoteSessionInfo[]> {
    const sessions = await this.jf.rawSessions();
    return sessions
      .filter(s => (s.Client ?? '').toLowerCase() === 'finamp')
      .map(s => ({
        id: s.Id,
        deviceName: s.DeviceName || 'Phone',
        nowPlayingName: s.NowPlayingItem?.Name ?? null,
        isPlaying: !!s.NowPlayingItem && !(s.PlayState?.IsPaused ?? true),
      }));
  }

  /** Current state of one session; null when it is gone (Finamp closed). */
  async state(sessionId: string): Promise<RemoteState | null> {
    const sessions = await this.jf.rawSessions();
    const s = sessions.find(x => x.Id === sessionId);
    if (!s) return null;
    const item = s.NowPlayingItem;
    return {
      track: item ? normalizeRemoteTrack(item) : null,
      positionMs: Math.round((s.PlayState?.PositionTicks ?? 0) / 10_000),
      paused: s.PlayState?.IsPaused ?? true,
      deviceName: s.DeviceName || 'Phone',
    };
  }

  command(sessionId: string, cmd: RemoteCommand, seekMs?: number): Promise<void> {
    const body: Record<string, unknown> = { Command: cmd };
    if (cmd === 'Seek' && seekMs !== undefined) body.SeekPositionTicks = Math.round(seekMs * 10_000);
    return this.jf.remotePlaystate(sessionId, cmd, body);
  }

  /** Start playback of items on the remote session; Finamp builds its queue. */
  playNow(sessionId: string, itemIds: string[], startIndex = 0): Promise<void> {
    return this.jf.remotePlay(sessionId, {
      ItemIds: itemIds,
      StartIndex: startIndex,
      PlayCommand: 'PlayNow',
    });
  }
}
