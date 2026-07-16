export {};

// setTimeout / setInterval host glue. JS-side state (the callback table) is
// keyed by timer id; the host (`__register_timer`/`__unregister_timer`) owns
// the actual scheduling and calls `__triggerTimer(id)` when a timer fires.

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
  } catch (e: any) {
    __host_log(e.stack ? String(e.stack) : String(e));
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
