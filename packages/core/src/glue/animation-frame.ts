// requestAnimationFrame host glue. The host (blitz-shell) drives rendering;
// `__tick` is called once per frame to drain queued rAF callbacks, run the
// solid-renderer sweep (finalization-registry cleanup), and flush the binary
// protocol frame back to Rust. `__hasRaf` tells the host whether to keep
// redrawing.

import { runSweep, writer } from "@blitz-quick/solid-renderer";

const rafQueue = new Map<number, (t: number) => void>();
let nextRafId = 1;

function requestAnimationFrameImpl(cb: (t: number) => void): number {
  const id = nextRafId++;
  rafQueue.set(id, cb);
  return id;
}

function cancelAnimationFrameImpl(id: number): void {
  rafQueue.delete(id);
}

function __tick(): boolean {
  const entries = Array.from(rafQueue.entries());
  rafQueue.clear();
  const now = performance.now();
  for (const [_, cb] of entries) {
    try {
      cb(now);
    } catch (e: any) {
      __host_log(e.stack ? String(e.stack) : String(e));
    }
  }
  runSweep();
  const bytes = writer.flush();
  if (bytes) __bridge_flush(bytes);
  return rafQueue.size > 0;
}

function __hasRaf(): boolean {
  return rafQueue.size > 0;
}

(globalThis as unknown as Record<string, unknown>).requestAnimationFrame =
  requestAnimationFrameImpl;
(globalThis as unknown as Record<string, unknown>).cancelAnimationFrame =
  cancelAnimationFrameImpl;
(globalThis as unknown as Record<string, unknown>).__tick = __tick;
(globalThis as unknown as Record<string, unknown>).__hasRaf = __hasRaf;
