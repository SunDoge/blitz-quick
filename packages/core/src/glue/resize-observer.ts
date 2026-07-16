export {};

// ResizeObserver host glue. The host (Rust) owns layout, so JS can't measure
// elements directly. The polyfill registers interest via
// `__resize_observe(solidId)`; the Applier measures the corresponding blitz
// node after each resolve and calls back through
// `__resize_dispatch(solidId, width, height)`, which we fan out to every
// observer watching that target.
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
