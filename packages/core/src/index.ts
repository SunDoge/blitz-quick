import { dispatchEvent, runSweep, writer } from "@blitz-quick/solid-renderer";

// Host-provided globals (injected by Rust).
declare global {
  function __bridge_flush(buf: Uint8Array): void;
  function __host_log(s: string): void;
  function requestAnimationFrame(cb: (t: number) => void): number;
  function __register_timer(id: number, delay: number, repeat: boolean): void;
  function __unregister_timer(id: number): void;
  function __host_utf8_encode(s: string): Uint8Array;
  function sysInfo(): string;
  function myCustomFfi(msg: string): string;
}

if (
  typeof TextEncoder === "undefined" &&
  typeof __host_utf8_encode !== "undefined"
) {
  class TextEncoderPolyfill {
    encode(s: string): Uint8Array {
      return __host_utf8_encode(s);
    }
  }
  (globalThis as any).TextEncoder = TextEncoderPolyfill;
}

// ---------------------------------------------------------------------------
// Host glue: rAF queue + tick drain + event dispatch.
// ---------------------------------------------------------------------------

const rafQueue: Array<(t: number) => void> = [];
function requestAnimationFrameImpl(cb: (t: number) => void): number {
  rafQueue.push(cb);
  return rafQueue.length;
}

function __tick(): boolean {
  const q = rafQueue.splice(0, rafQueue.length);
  for (const cb of q) {
    try {
      cb(performance.now());
    } catch (e) {
      __host_log(String(e));
    }
  }
  runSweep();
  const bytes = writer.flush();
  if (bytes) __bridge_flush(bytes);
  return rafQueue.length > 0;
}

function __dispatchEvent(
  solidId: number,
  eventCode: number,
  payload: string,
): void {
  dispatchEvent(solidId, eventCode, payload);
}

function __hasRaf(): boolean {
  return rafQueue.length > 0;
}

(globalThis as unknown as Record<string, unknown>).requestAnimationFrame =
  requestAnimationFrameImpl;
(globalThis as unknown as Record<string, unknown>).__tick = __tick;
(globalThis as unknown as Record<string, unknown>).__dispatchEvent =
  __dispatchEvent;
(globalThis as unknown as Record<string, unknown>).__hasRaf = __hasRaf;

const timers = new Map<
  number,
  { cb: (...args: any[]) => void; args: any[]; repeat: boolean }
>();
let nextTimerId = 1;

function setTimeoutImpl(
  cb: (...args: any[]) => void,
  delay?: number,
  ...args: any[]
): number {
  const id = nextTimerId++;
  timers.set(id, { cb, args, repeat: false });
  __register_timer(id, delay || 0, false);
  return id;
}

function clearTimeoutImpl(id: number): void {
  timers.delete(id);
  __unregister_timer(id);
}

function setIntervalImpl(
  cb: (...args: any[]) => void,
  delay?: number,
  ...args: any[]
): number {
  const id = nextTimerId++;
  timers.set(id, { cb, args, repeat: true });
  __register_timer(id, delay || 0, true);
  return id;
}

function __triggerTimer(id: number): void {
  const entry = timers.get(id);
  if (!entry) return;
  try {
    entry.cb(...entry.args);
  } catch (e) {
    __host_log(String(e));
  }
  if (!entry.repeat) {
    timers.delete(id);
  }
}

(globalThis as any).setTimeout = setTimeoutImpl;
(globalThis as any).clearTimeout = clearTimeoutImpl;
(globalThis as any).setInterval = setIntervalImpl;
(globalThis as any).clearInterval = clearTimeoutImpl;
(globalThis as any).__triggerTimer = __triggerTimer;
