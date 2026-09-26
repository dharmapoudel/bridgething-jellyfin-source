// Shared gate for ALL phone-tunnel traffic (net.fetch JSON, artwork, remote
// commands). The iPhone companion buffers each net.fetch reply fully before
// sending it back as a single gateway message; firing ~9 concurrent fetches
// on app load wedges the companion and stalls the Bluetooth link. This
// semaphore caps total concurrent tunneled requests at 3 — JSON, art, and
// commands all draw from the same pool, so the phone is never asked to
// juggle more than 3 in flight. FIFO, except 'front' priority jumps the
// queue (user-initiated commands and on-screen art beat background work).
const MAX_CONCURRENT = 3;

type Task = {
  run: () => Promise<unknown>;
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
};

const queue: Task[] = [];
let active = 0;

function pump(): void {
  while (active < MAX_CONCURRENT && queue.length) {
    const t = queue.shift()!;
    active++;
    t.run().then(
      v => {
        active--;
        t.resolve(v);
        pump();
      },
      e => {
        active--;
        t.reject(e);
        pump();
      },
    );
  }
}

// priority 'front': the task jumps ahead of queued work (but never preempts
// a running one). 'back': normal FIFO order.
export function gatedNet<T>(task: () => Promise<T>, priority: 'front' | 'back' = 'back'): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t: Task = { run: task, resolve: resolve as (v: unknown) => void, reject };
    if (priority === 'front') queue.unshift(t);
    else queue.push(t);
    pump();
  });
}
