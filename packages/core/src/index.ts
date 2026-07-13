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
