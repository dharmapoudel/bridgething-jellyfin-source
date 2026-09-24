// Playback engine. The phone's stream provider only understands
// play/pause/resume/seekTo on a raw http(s) uri, so Finch keeps its OWN
// queue (tracks + index + repeat/shuffle) and calls play() per track.
// Snapshots from the daemon drive state; the progress bar extrapolates
// locally between them.

import { getClient } from './client';
import { JellyfinClient, type Track } from './jellyfin';

export type RepeatMode = 'off' | 'all' | 'one';

const CONTEXT_PREFIX = 'finch:track:';
const RESUME_KEY = 'finch:resume';
const DEVICE_ID_KEY = 'finch:device-id';
const PROGRESS_REPORT_MS = 30_000;
const PLAY_GRACE_MS = 1500;

export interface PersistedQueue {
  tracks: Track[];
  index: number;
  positionMs: number;
}

function shuffled<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export class PlaybackEngine {
  private jf: JellyfinClient | null = null;
  private deviceId = '';
  private listeners = new Set<() => void>();

  queue: Track[] = [];
  index = -1;
  intentPlaying = false;
  loading = false;
  error: string | null = null;
  external = false;
  shuffle = false;
  repeat: RepeatMode = 'off';
  volume: number | null = null;
  muted = false;
  private rev = 0;

  private positionMs = 0;
  private positionAt = 0;
  private durationMs = 0;
  private awaitingStart = false;
  private lastPlayAt = 0;
  private sessionId = '';
  private progressTimer: number | null = null;
  // latest daemon snapshot, for resume reconciliation after an app restart
  private snapSeen = false;
  private snapTrackId: string | null = null;
  private snapPlaying = false;
  private snapPositionMs = 0;
  private adopting: string | null = null;

  configure(jf: JellyfinClient | null): void {
    this.jf = jf;
    this.emit();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    this.rev++;
    for (const fn of this.listeners) fn();
  }

  get revision(): number {
    return this.rev;
  }

  // force a ui refresh after mutating a queued track in place (e.g. favorite)
  touch(): void {
    this.emit();
  }

  current(): Track | null {
    return this.index >= 0 && this.index < this.queue.length ? this.queue[this.index] : null;
  }

  positionNow(): number {
    if (this.intentPlaying && this.positionMs >= 0) {
      return Math.min(this.positionMs + (Date.now() - this.positionAt), this.durationMs || Infinity);
    }
    return this.positionMs;
  }

  get trackDurationMs(): number {
    return this.durationMs;
  }

  private streamUrl(track: Track): string {
    return this.jf!.streamUrl(track.id, this.deviceId);
  }

  async ensureDeviceId(): Promise<void> {
    if (this.deviceId) return;
    const client = getClient();
    try {
      const r = await client.store.get({ key: DEVICE_ID_KEY });
      if (r.ok && r.response.value) {
        this.deviceId = r.response.value;
        return;
      }
    } catch {
      // fall through to generate
    }
    this.deviceId = crypto.randomUUID();
    try {
      await client.store.put({ key: DEVICE_ID_KEY, value: this.deviceId });
    } catch {
      // non-fatal
    }
  }

  private newSession(): string {
    this.sessionId = crypto.randomUUID();
    return this.sessionId;
  }

  private armProgressTimer(): void {
    this.clearProgressTimer();
    this.progressTimer = window.setInterval(() => {
      const t = this.current();
      if (t && this.intentPlaying && this.jf) {
        void this.jf.reportProgress(t.id, this.sessionId, this.positionNow(), false);
      }
    }, PROGRESS_REPORT_MS);
  }

  private clearProgressTimer(): void {
    if (this.progressTimer !== null) {
      window.clearInterval(this.progressTimer);
      this.progressTimer = null;
    }
  }

  async playQueue(tracks: Track[], startIndex = 0, shuffle = this.shuffle): Promise<void> {
    if (!tracks.length || !this.jf) return;
    let list = [...tracks];
    let idx = Math.max(0, Math.min(startIndex, list.length - 1));
    if (shuffle && list.length > 1) {
      const first = list[idx];
      list = [first, ...shuffled(list.filter((_, i) => i !== idx))];
      idx = 0;
    }
    this.queue = list;
    await this.playAt(idx);
  }

  private async playAt(i: number): Promise<void> {
    const track = this.queue[i];
    if (!track || !this.jf) return;
    const prev = this.current();
    if (prev && prev.id !== track.id) {
      void this.jf.reportStopped(prev.id, this.sessionId, this.positionNow()).catch(() => {});
    }
    this.index = i;
    this.durationMs = track.durationMs;
    this.positionMs = 0;
    this.positionAt = Date.now();
    this.loading = true;
    this.error = null;
    this.external = false;
    this.awaitingStart = true;
    this.lastPlayAt = Date.now();
    this.newSession();
    this.emit();
    try {
      await getClient().player.play({
        uri: this.streamUrl(track),
        context: { contextUri: `${CONTEXT_PREFIX}${track.id}` },
      });
      void this.jf.reportPlaying(track.id, this.sessionId);
      this.armProgressTimer();
      void this.persist();
    } catch (err) {
      this.loading = false;
      this.awaitingStart = false;
      this.error = err instanceof Error ? err.message : 'could not start playback';
      this.emit();
    }
  }

  async toggle(): Promise<void> {
    if (this.external) return;
    const t = this.current();
    if (!t) return;
    const client = getClient();
    try {
      if (this.intentPlaying) {
        this.intentPlaying = false;
        void this.jf?.reportProgress(t.id, this.sessionId, this.positionNow(), true);
        this.clearProgressTimer();
        this.emit();
        await client.player.pause();
      } else {
        this.awaitingStart = true;
        this.lastPlayAt = Date.now();
        this.emit();
        await client.player.resume();
      }
      void this.persist();
    } catch {
      // snapshot will correct us
    }
  }

  async next(auto = false): Promise<void> {
    if (this.repeat === 'one' && auto) {
      await this.playAt(this.index);
      return;
    }
    let n = this.index + 1;
    if (n >= this.queue.length) {
      if (this.repeat === 'all' && this.queue.length) n = 0;
      else {
        this.intentPlaying = false;
        this.clearProgressTimer();
        const t = this.current();
        if (t) void this.jf?.reportStopped(t.id, this.sessionId, this.positionNow()).catch(() => {});
        this.emit();
        return;
      }
    }
    await this.playAt(n);
  }

  async prev(): Promise<void> {
    // restart the track when it is well underway, like every other player
    if (this.positionNow() > 4000) {
      await this.seekTo(0);
      return;
    }
    const p = this.index - 1;
    if (p >= 0) await this.playAt(p);
    else await this.seekTo(0);
  }

  async seekTo(ms: number): Promise<void> {
    const t = this.current();
    if (!t) return;
    const clamped = Math.max(0, Math.min(ms, this.durationMs || ms));
    this.positionMs = clamped;
    this.positionAt = Date.now();
    this.emit();
    try {
      await getClient().player.seekTo({ positionMs: Math.round(clamped) });
    } catch {
      // best effort
    }
  }

  setShuffle(on: boolean): void {
    this.shuffle = on;
    this.emit();
    void this.persistPrefs();
  }

  cycleRepeat(): void {
    this.repeat = this.repeat === 'off' ? 'all' : this.repeat === 'all' ? 'one' : 'off';
    this.emit();
    void this.persistPrefs();
  }

  playNext(track: Track): void {
    if (this.index < 0) {
      void this.playQueue([track], 0);
      return;
    }
    this.queue.splice(this.index + 1, 0, track);
    this.emit();
  }

  addToQueue(track: Track): void {
    if (this.index < 0) {
      void this.playQueue([track], 0);
      return;
    }
    this.queue.push(track);
    this.emit();
  }

  removeAt(i: number): void {
    if (i < 0 || i >= this.queue.length) return;
    this.queue.splice(i, 1);
    if (i < this.index) this.index--;
    else if (i === this.index) {
      // removing the playing track stops playback; keep the rest queued
      this.intentPlaying = false;
      this.clearProgressTimer();
      if (this.index >= this.queue.length) this.index = this.queue.length - 1;
      const t = this.current();
      if (t) {
        this.durationMs = t.durationMs;
        this.positionMs = 0;
        this.positionAt = Date.now();
      } else {
        this.index = -1;
      }
    }
    this.emit();
  }

  clearQueue(): void {
    this.queue = [];
    this.index = -1;
    this.intentPlaying = false;
    this.clearProgressTimer();
    this.emit();
    void this.persist();
  }

  jumpTo(i: number): Promise<void> {
    return this.playAt(i);
  }

  // Feed every daemon snapshot through here. Returns nothing; emits on change.
  handleSnapshot(state: {
    context: { uri: string } | null;
    playback: { state: 'stopped' | 'paused' | 'playing'; positionMs: number };
  }): void {
    const ctxUri = state.context?.uri ?? null;
    // remember the raw snapshot for resume reconciliation (app restarted
    // while the phone kept playing one of our tracks)
    this.snapSeen = true;
    this.snapTrackId =
      ctxUri && ctxUri.startsWith(CONTEXT_PREFIX) ? ctxUri.slice(CONTEXT_PREFIX.length) : null;
    this.snapPlaying = state.playback.state === 'playing';
    this.snapPositionMs = state.playback.positionMs;
    if (ctxUri && !ctxUri.startsWith(CONTEXT_PREFIX)) {
      // another app took the phone; stop claiming playback
      if (!this.external) {
        this.external = true;
        this.intentPlaying = false;
        this.loading = false;
        this.clearProgressTimer();
        this.emit();
      }
      return;
    }
    if (this.external) {
      this.external = false;
    }
    const pb = state.playback;
    if (pb.state === 'playing') {
      this.intentPlaying = true;
      this.loading = false;
      this.awaitingStart = false;
      this.error = null;
      this.positionMs = pb.positionMs;
      this.positionAt = Date.now();
      const t = this.current();
      if (t && t.durationMs) this.durationMs = t.durationMs;
      this.emit();
    } else if (pb.state === 'paused') {
      this.positionMs = pb.positionMs;
      this.positionAt = Date.now();
      if (!this.awaitingStart) this.intentPlaying = false;
      this.loading = false;
      this.emit();
    } else {
      // stopped: either we stopped it (intent already false) or the track
      // ended on its own -> advance. ignore the transient stopped right
      // after play() while the phone spins up.
      this.loading = false;
      if (this.awaitingStart && Date.now() - this.lastPlayAt < PLAY_GRACE_MS) return;
      this.awaitingStart = false;
      if (this.intentPlaying) {
        this.intentPlaying = false;
        this.emit();
        void this.next(true);
      } else {
        this.emit();
      }
    }
    // The phone is playing/paused one of our tracks but our queue is empty
    // (app restarted mid-playback): pull the track from the server so the UI
    // shows the true now-playing status.
    if (!this.current() && this.snapTrackId && this.jf && this.adopting !== this.snapTrackId) {
      void this.adoptTrackId(this.snapTrackId, this.snapPositionMs, this.snapPlaying);
    }
  }

  // Adopt a track the phone is already playing into an empty queue.
  private async adoptTrackId(id: string, positionMs: number, playing: boolean): Promise<void> {
    if (!this.jf || this.current() || this.adopting === id) return;
    this.adopting = id;
    try {
      const t = await this.jf.trackById(id);
      if (this.current()) return; // something started meanwhile
      this.queue = [t];
      this.index = 0;
      this.durationMs = t.durationMs;
      this.positionMs = Math.max(0, positionMs);
      this.positionAt = Date.now();
      this.intentPlaying = playing;
      this.loading = false;
      this.awaitingStart = false;
      this.external = false;
      this.error = null;
      this.emit();
      void this.persist();
    } catch {
      // leave the queue empty; a later snapshot or reconcile will retry
    } finally {
      if (this.adopting === id) this.adopting = null;
    }
  }

  // Called once when credentials become ready. If our queue is empty but
  // playback is actually underway — the phone kept playing after an app
  // restart, or the server shows a recent session for our device — adopt it
  // so the UI shows the true status instead of an empty player.
  async reconcileOnResume(): Promise<void> {
    if (!this.jf || this.current()) return;
    // daemon snapshot is ground truth: it already triggers adoption via
    // handleSnapshot, and a definitive stopped state means "not playing".
    if (this.snapTrackId) {
      await this.adoptTrackId(this.snapTrackId, this.snapPositionMs, this.snapPlaying);
      return;
    }
    if (this.snapSeen) return;
    try {
      const np = await this.jf.serverNowPlaying();
      if (np && !this.current()) {
        this.queue = [np.track];
        this.index = 0;
        this.durationMs = np.track.durationMs;
        this.positionMs = Math.max(0, np.positionMs);
        this.positionAt = Date.now();
        this.intentPlaying = !np.paused;
        this.loading = false;
        this.external = false;
        this.error = null;
        this.emit();
        void this.persist();
      }
    } catch {
      // no session info; stay empty
    }
  }

  handlePlayerError(type: string): void {
    this.loading = false;
    this.awaitingStart = false;
    this.intentPlaying = false;
    this.clearProgressTimer();
    if (type === 'noGateway') this.error = 'Connect your phone to hear audio.';
    else if (type === 'schemeUnclaimed') this.error = 'Update the companion app to play audio.';
    else if (type === 'playFailed') this.error = 'Playback failed. Try another track.';
    else this.error = 'Could not play this track.';
    this.emit();
  }

  private async persistPrefs(): Promise<void> {
    try {
      await getClient().store.put({
        key: 'finch:prefs',
        value: JSON.stringify({ shuffle: this.shuffle, repeat: this.repeat }),
      });
    } catch {
      // non-fatal
    }
  }

  async loadPrefs(): Promise<void> {
    try {
      const r = await getClient().store.get({ key: 'finch:prefs' });
      if (r.ok && r.response.value) {
        const p = JSON.parse(r.response.value) as { shuffle?: boolean; repeat?: RepeatMode };
        if (typeof p.shuffle === 'boolean') this.shuffle = p.shuffle;
        if (p.repeat === 'off' || p.repeat === 'all' || p.repeat === 'one') this.repeat = p.repeat;
      }
    } catch {
      // non-fatal
    }
  }

  private async persist(): Promise<void> {
    const t = this.current();
    if (!t) return;
    try {
      const data: PersistedQueue = {
        tracks: this.queue.slice(0, 200),
        index: this.index,
        positionMs: Math.round(this.positionNow()),
      };
      await getClient().store.put({ key: RESUME_KEY, value: JSON.stringify(data) });
    } catch {
      // non-fatal
    }
  }

  async loadPersisted(): Promise<PersistedQueue | null> {
    try {
      const r = await getClient().store.get({ key: RESUME_KEY });
      if (r.ok && r.response.value) {
        const p = JSON.parse(r.response.value) as PersistedQueue;
        if (Array.isArray(p.tracks) && p.tracks.length && p.index >= 0 && p.index < p.tracks.length) return p;
      }
    } catch {
      // non-fatal
    }
    return null;
  }
}

export const player = new PlaybackEngine();
