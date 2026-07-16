class DummyURL {
  pathname: string;
  search: string;
  hash: string;
  href: string;
  constructor(url: string, base?: string | DummyURL) {
    let full = url;
    let baseStr =
      typeof base === "string" ? base : base ? base.href : undefined;
    if (baseStr && !url.startsWith("http"))
      full = baseStr + (url.startsWith("/") ? "" : "/") + url;
    const [pathAndQuery, hash] = full.split("#");
    const [path, search] = pathAndQuery.split("?");
    this.pathname = path.replace(/^https?:\/\/[^\/]+/, "");
    if (!this.pathname.startsWith("/")) this.pathname = "/" + this.pathname;
    this.search = search ? "?" + search : "";
    this.hash = hash ? "#" + hash : "";
    this.href = full;
  }
  toString() {
    return this.href;
  }
}
(globalThis as any).URL = DummyURL;

class DummyURLSearchParams {
  params: Record<string, string> = {};
  constructor(init?: string | Record<string, string>) {
    if (typeof init === "string") {
      const query = init.startsWith("?") ? init.slice(1) : init;
      for (const pair of query.split("&")) {
        const [k, v] = pair.split("=");
        if (k) this.params[decodeURIComponent(k)] = decodeURIComponent(v || "");
      }
    } else if (init) {
      this.params = { ...init };
    }
  }
  get(k: string) {
    return this.params[k] ?? null;
  }
  set(k: string, v: string) {
    this.params[k] = v;
  }
  has(k: string) {
    return k in this.params;
  }
  delete(k: string) {
    delete this.params[k];
  }
  toString() {
    return Object.entries(this.params)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join("&");
  }
  *entries() {
    for (const k in this.params) yield [k, this.params[k]];
  }
  forEach(cb: any) {
    for (const k in this.params) cb(this.params[k], k, this);
  }
}
(globalThis as any).URLSearchParams = DummyURLSearchParams;

(globalThis as any).document = {
  addEventListener: () => {},
  removeEventListener: () => {},
  getElementById: () => null,
  baseURI: "http://localhost",
};

import { dispatchEvent, runSweep, writer } from "@blitz-quick/solid-renderer";

// Host-provided globals (injected by Rust).
declare global {
  function __bridge_flush(buf: Uint8Array): void;
  function __host_log(s: string): void;
  function __host_log_level(tag: string, msg: string): void;
  function __fetch_start(
    id: number,
    url: string,
    method: string,
    headers: string,
    body: string | null,
    resolve: (res: any) => void,
    reject: (err: any) => void,
  ): void;
  function requestAnimationFrame(cb: (t: number) => void): number;
  function __register_timer(id: number, delay: number, repeat: boolean): void;
  function __unregister_timer(id: number): void;
  function __host_utf8_encode(s: string): Uint8Array;
  function __host_utf8_decode(bytes: Uint8Array): string;
  function sysInfo(): string;
  function myCustomFfi(msg: string): string;
  function __resize_observe(solidId: number): void;
  function __resize_unobserve(solidId: number): void;
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

if (
  typeof TextDecoder === "undefined" &&
  typeof __host_utf8_decode !== "undefined"
) {
  // Minimal TextDecoder: UTF-8 only (the only encoding the host fn supports),
  // non-fatal by default (invalid bytes become U+FFFD, matching the spec's
  // default `fatal: false`). The `fatal` option is honored by re-checking.
  class TextDecoderPolyfill {
    private fatal: boolean;
    constructor(label?: string, options?: { fatal?: boolean }) {
      // Label is ignored — we only speak UTF-8.
      this.fatal = options?.fatal ?? false;
    }
    decode(bytes: Uint8Array): string {
      const s = __host_utf8_decode(bytes);
      if (this.fatal) {
        // Round-trip check: re-encode and compare. U+FFFD from lossy decode
        // only appears when input was invalid, so a mismatch means the bytes
        // weren't valid UTF-8.
        const re = __host_utf8_encode(s);
        if (re.length !== bytes.length || !re.every((b, i) => b === bytes[i])) {
          throw new TypeError("The encoded data was not valid UTF-8");
        }
      }
      return s;
    }
  }
  (globalThis as any).TextDecoder = TextDecoderPolyfill;
}

// structuredClone polyfill — QuickJS doesn't ship it. Covers plain objects,
// arrays, Date, RegExp, Map, Set, ArrayBuffers and typed arrays. Functions
// and symbols are not cloneable per the spec and throw.
if (typeof structuredClone === "undefined") {
  function structuredClonePolyfill<T>(value: T, _options?: any): T {
    const seen = new Map<any, any>();
    const clone = (v: any): any => {
      if (v === null || typeof v !== "object") return v;
      if (seen.has(v)) return seen.get(v);
      if (typeof v === "function" || typeof v === "symbol") {
        throw new TypeError("structuredClone: function/symbol not cloneable");
      }
      if (v instanceof Date) {
        const c = new Date(v.getTime());
        seen.set(v, c);
        return c;
      }
      if (v instanceof RegExp) {
        const c = new RegExp(v.source, v.flags);
        seen.set(v, c);
        return c;
      }
      if (v instanceof Map) {
        const c = new Map();
        seen.set(v, c);
        for (const [k, val] of v) c.set(clone(k), clone(val));
        return c;
      }
      if (v instanceof Set) {
        const c = new Set();
        seen.set(v, c);
        for (const val of v) c.add(clone(val));
        return c;
      }
      if (v instanceof ArrayBuffer) {
        const c = v.slice(0);
        seen.set(v, c);
        return c;
      }
      if (ArrayBuffer.isView(v)) {
        // Typed array: clone its buffer and wrap in the same view type.
        const ctor = (v as any).constructor;
        const buf = clone(v.buffer);
        const c = new ctor(buf, v.byteOffset, v.length);
        seen.set(v, c);
        return c;
      }
      if (Array.isArray(v)) {
        const c: any[] = [];
        seen.set(v, c);
        for (const item of v) c.push(clone(item));
        return c;
      }
      const c: Record<string, any> = Object.create(Object.getPrototypeOf(v));
      seen.set(v, c);
      for (const k of Object.keys(v)) c[k] = clone(v[k]);
      return c;
    };
    return clone(value) as T;
  }
  (globalThis as any).structuredClone = structuredClonePolyfill;
}

// ---------------------------------------------------------------------------
// Polyfills (formerly HOST_BOOTSTRAP in Rust)
// ---------------------------------------------------------------------------

function emitConsole(tag: string, args: IArguments) {
  const parts = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    parts.push(typeof a === "string" ? a : String(a));
  }
  __host_log_level(tag, parts.join(" "));
}

(globalThis as any).console = {
  log: function () {
    emitConsole("log", arguments);
  },
  info: function () {
    emitConsole("info", arguments);
  },
  warn: function () {
    emitConsole("warn", arguments);
  },
  error: function () {
    emitConsole("error", arguments);
  },
  debug: function () {
    emitConsole("debug", arguments);
  },
};

(globalThis as any).window = {
  history: {
    state: {},
    replaceState: function (s: any) {
      this.state = s;
    },
    go: function () {},
    length: 1,
  },
  location: {
    origin: "http://localhost",
    pathname: "/",
    search: "",
    hash: "",
  },
  scrollTo: function () {},
};

let nextFetchId = 1;
(globalThis as any).fetch = function (url: string, init?: any) {
  const id = nextFetchId++;
  const method = init && init.method ? String(init.method) : "GET";
  const headers = init && init.headers ? JSON.stringify(init.headers) : "{}";
  const body = init && init.body ? String(init.body) : null;
  return new Promise(function (resolve, reject) {
    __fetch_start(id, String(url), method, headers, body, resolve, reject);
  }).then(function (res: any) {
    if (res.error) throw new Error(res.error);
    return {
      status: res.status,
      headers: res.headers,
      text: function () {
        return Promise.resolve(res.body);
      },
      json: function () {
        return Promise.resolve(JSON.parse(res.body));
      },
    };
  });
};

// ---------------------------------------------------------------------------
// Host glue: rAF queue + tick drain + event dispatch.
// ---------------------------------------------------------------------------

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

function __dispatchEvent(
  solidId: number,
  eventCode: number,
  payload: string,
): void {
  dispatchEvent(solidId, eventCode, payload);
}

function __hasRaf(): boolean {
  return rafQueue.size > 0;
}

(globalThis as unknown as Record<string, unknown>).requestAnimationFrame =
  requestAnimationFrameImpl;
(globalThis as unknown as Record<string, unknown>).cancelAnimationFrame =
  cancelAnimationFrameImpl;
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

// ---------------------------------------------------------------------------
// ResizeObserver polyfill
// ---------------------------------------------------------------------------
//
// The host (Rust) owns layout, so JS can't measure elements directly. The
// polyfill registers interest via `__resize_observe(solidId)`; the Applier
// measures the corresponding blitz node after each resolve and calls back
// through `__resize_dispatch(solidId, width, height)`, which we fan out to
// every observer watching that target.
//
// `target` is a SolidJS handle (the universal renderer's node) whose `id`
// field is the Solid virtual id the Applier maps to a blitz node.

interface ResizeObserverEntry {
  target: { id: number };
  contentRect: { width: number; height: number };
}

type ResizeObserverCallback = (entries: ResizeObserverEntry[]) => void;

// solidId -> set of observer callbacks (a target can be observed by multiple
// ResizeObserver instances, per the spec).
const resizeObservers = new Map<number, Set<ResizeObserverCallback>>();

class ResizeObserver {
  private callback: ResizeObserverCallback;
  private targets = new Set<number>();

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }

  observe(target: { id: number }): void {
    const id = target.id;
    if (this.targets.has(id)) return;
    this.targets.add(id);
    let set = resizeObservers.get(id);
    if (!set) {
      set = new Set();
      resizeObservers.set(id, set);
      __resize_observe(id);
    }
    set.add(this.callback);
  }

  unobserve(target: { id: number }): void {
    const id = target.id;
    if (!this.targets.has(id)) return;
    this.targets.delete(id);
    const set = resizeObservers.get(id);
    if (set) {
      set.delete(this.callback);
      if (set.size === 0) {
        resizeObservers.delete(id);
        __resize_unobserve(id);
      }
    }
  }

  disconnect(): void {
    for (const id of this.targets) {
      const set = resizeObservers.get(id);
      if (set) {
        set.delete(this.callback);
        if (set.size === 0) {
          resizeObservers.delete(id);
          __resize_unobserve(id);
        }
      }
    }
    this.targets.clear();
  }
}

// Host -> JS: a target's content-box size changed (or was measured for the
// first time). Batch per-frame is not attempted here; the host already only
// pushes on change, and observers generally just read a signal.
(globalThis as any).__resize_dispatch = (
  solidId: number,
  width: number,
  height: number,
): void => {
  const set = resizeObservers.get(solidId);
  if (!set || set.size === 0) return;
  const entry: ResizeObserverEntry = {
    target: { id: solidId },
    contentRect: { width, height },
  };
  for (const cb of set) {
    try {
      cb([entry]);
    } catch (e: any) {
      __host_log(`ResizeObserver callback error: ${e?.stack ?? e}`);
    }
  }
};

(globalThis as any).ResizeObserver = ResizeObserver;
