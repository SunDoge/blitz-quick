type AcceptCallback = (module: unknown) => void;
type DisposeCallback = (data: Record<string, unknown>) => void;

declare function __vite_update_style(id: string, css: string): void;
declare function __vite_remove_style(id: string): void;

interface HotContext {
  data: Record<string, unknown>;
  accepted: AcceptCallback[];
  disposed: DisposeCallback[];
  invalidated: boolean;
  accept(callback?: AcceptCallback): void;
  dispose(callback: DisposeCallback): void;
  decline(): void;
  invalidate(): void;
  on(): void;
  send(): void;
  prune(): void;
}

interface HotRecord {
  data: Record<string, unknown>;
  current: HotContext | null;
  next: HotContext | null;
  loading: boolean;
}

type BlitzGlobal = typeof globalThis & {
  __blitz_hmr_records?: Map<string, HotRecord>;
  __blitz_apply_hmr?: (
    path: string,
    acceptedPath: string,
    timestamp: number,
  ) => Promise<boolean>;
};

const blitzGlobal = globalThis as BlitzGlobal;
const existingRecords = blitzGlobal.__blitz_hmr_records;
const records = existingRecords ?? new Map<string, HotRecord>();
if (!existingRecords) {
  blitzGlobal.__blitz_hmr_records = records;
}

function nextContext(record: HotRecord): HotContext | null {
  return record.next;
}

export function createHotContext(ownerPath: string): HotContext {
  let record = records.get(ownerPath);
  if (!record) {
    record = { data: {}, current: null, next: null, loading: false };
    records.set(ownerPath, record);
  }

  const context: HotContext = {
    data: record.data,
    accepted: [],
    disposed: [],
    invalidated: false,
    accept(callback) {
      if (typeof callback === "function") this.accepted.push(callback);
    },
    dispose(callback) {
      this.disposed.push(callback);
    },
    decline() {
      this.invalidated = true;
    },
    invalidate() {
      this.invalidated = true;
    },
    on() {},
    send() {},
    prune() {},
  };

  if (record.loading) record.next = context;
  else record.current = context;
  return context;
}

// Vite-generated CSS modules call these hooks during initial evaluation.
// Keep the native document stylesheet in Rust because QuickJS has no browser
// style element for Vite to mutate.
export function updateStyle(id: string, css: string): void {
  __vite_update_style(id, css);
}

export function removeStyle(id: string): void {
  __vite_remove_style(id);
}

blitzGlobal.__blitz_apply_hmr = async (path, acceptedPath, timestamp) => {
  const record = records.get(path);
  if (!record?.current) return false;

  const previous = record.current;
  for (const dispose of previous.disposed) dispose(record.data);
  record.loading = true;
  record.next = null;

  try {
    const separator = acceptedPath.includes("?") ? "&" : "?";
    const module = await import(`${acceptedPath}${separator}t=${timestamp}`);
    const next = nextContext(record);
    if (!next || next.invalidated) return false;
    record.current = next;
    for (const accept of previous.accepted) accept(module);
    return !previous.invalidated;
  } finally {
    record.loading = false;
    record.next = null;
  }
};
