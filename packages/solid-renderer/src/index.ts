// @blitz-quick/solid-renderer
//
// Binds real `solid-js` to the binary bridge: implements
// `solid-js/universal`'s `RendererOptions<NodeType>` over an in-memory handle
// tree, where every mutation emits a protocol op into a shared `Writer`.
// Solid owns the reactive core + reconciler (createSignal/<For>/JSX); we only
// supply the node hooks.
//
// Solid's universal JSX compiles to
//   `import { createElement, insertNode, insert, setProp, createComponent }
//    from "<moduleName>"`
// where moduleName is this package. So we eagerly build ONE renderer at module
// load and re-export its methods as named exports below.

import { EVENT_CODE, type EventType, OP, Writer } from "@blitz-quick/protocol";
import { createMemo, splitProps, untrack } from "solid-js";
export const isServer = false;
export const getRequestEvent = () => undefined;
export const delegateEvents = () => {};
import type { JSX } from "solid-js";
import { createRenderer as solidCreateRenderer } from "solid-js/universal";

// Host-provided global (injected by Rust) for logging from the renderer.
declare function __host_log(s: string): void;

/** A pure-JS handle standing in for a DOM node. id == protocol node id. */
export interface Handle {
  id: number;
  tag: string;
  parent: Handle | null;
  firstChild: Handle | null;
  lastChild: Handle | null;
  prev: Handle | null;
  next: Handle | null;
}

const FREE_LIST: number[] = [];
const GENERATIONS: number[] = [];
let nextSlot = 2; // 1 is reserved for the host-supplied root mount

const listenersBySlot: (Map<number, (e: unknown) => void> | undefined)[] = [];
/** solid id -> WeakRef<Handle>, so event dispatch can walk the parent chain for bubbling without leaking memory. */
const nodesBySlot: (WeakRef<Handle> | undefined)[] = [];

const finalizationRegistry =
  typeof FinalizationRegistry !== "undefined"
    ? new FinalizationRegistry<number>((id) => {
        const slot = id & 0xfffff;
        const expectedGen = id >>> 20;
        if (GENERATIONS[slot] !== expectedGen) return;
        nodesBySlot[slot] = undefined;
        listenersBySlot[slot] = undefined;
        writer.dropNode(id);
        freeId(id);
      })
    : null;

const sweepSet = new Set<Handle>();

export function runSweep(): void {
  if (sweepSet.size === 0) return;
  for (const node of sweepSet) {
    if (node.parent !== null) continue; // re-attached

    // recursively destroy
    const destroy = (n: Handle) => {
      const slot = n.id & 0xfffff;
      if (nodesBySlot[slot] === undefined) return;

      finalizationRegistry?.unregister(n);
      nodesBySlot[slot] = undefined;
      listenersBySlot[slot] = undefined;
      writer.dropNode(n.id);
      freeId(n.id);
      let c = n.firstChild;
      while (c) {
        destroy(c);
        c = c.next;
      }
    };
    destroy(node);
  }
  sweepSet.clear();
}

function newId(): number {
  let slot: number;
  if (FREE_LIST.length > 0) {
    slot = FREE_LIST.pop()!;
  } else {
    slot = nextSlot++;
    GENERATIONS[slot] = 0;
  }
  const gen = GENERATIONS[slot];
  return ((gen << 20) | slot) >>> 0;
}

function freeId(id: number) {
  const slot = id & 0xfffff;
  GENERATIONS[slot] = (GENERATIONS[slot] + 1) & 0xfff;
  FREE_LIST.push(slot);
}

function makeHandle(tag: string): Handle {
  const id = newId();
  const h: Handle = {
    id,
    tag,
    parent: null,
    firstChild: null,
    lastChild: null,
    prev: null,
    next: null,
  };
  if (typeof WeakRef !== "undefined") {
    nodesBySlot[id & 0xfffff] = new WeakRef(h);
  }
  if (finalizationRegistry) {
    finalizationRegistry.register(h, h.id, h);
  }
  return h;
}

function linkChild(parent: Handle, child: Handle, ref: Handle | null): void {
  child.parent = parent;
  if (ref == null) {
    child.prev = parent.lastChild;
    child.next = null;
    if (parent.lastChild) parent.lastChild.next = child;
    else parent.firstChild = child;
    parent.lastChild = child;
  } else {
    child.prev = ref.prev;
    child.next = ref;
    if (ref.prev) ref.prev.next = child;
    else parent.firstChild = child;
    ref.prev = child;
  }
}

function unlinkChild(parent: Handle, child: Handle): void {
  if (child.prev) child.prev.next = child.next;
  else parent.firstChild = child.next;
  if (child.next) child.next.prev = child.prev;
  else parent.lastChild = child.prev;
  child.parent = child.prev = child.next = null;
}

/** Translate a setProperty call into protocol ops. Shared by both hooks. */
function applyProperty(
  writer: Writer,
  node: Handle,
  name: string,
  value: unknown,
  prev: unknown,
): void {
  if (value === prev) return;
  if (value == null || value === false) {
    // Event handlers are stored under listenersByNode (keyed by event code),
    // not as DOM attributes — so an on* prop going null/false must remove the
    // listener, not call removeAttribute (which would be a no-op and leak the
    // old handler). Matches the binding side in the on* branch below.
    if (name.startsWith("on") && name.length > 2) {
      const t = EVENT_CODE[name.slice(2).toLowerCase() as EventType] ?? null;
      if (t != null) {
        const slot = node.id & 0xfffff;
        writer.removeEventListener(node.id, t);
        listenersBySlot[slot]?.delete(t);
      }
      return;
    }
    writer.removeAttribute(node.id, name);
    return;
  }
  if (name === "class" || name === "className") {
    writer.setClassName(node.id, String(value));
    return;
  }
  if (name === "style" && typeof value === "object" && value !== null) {
    const rec = value as Record<string, string>;
    const prec = (prev && typeof prev === "object" ? prev : {}) as Record<
      string,
      string
    >;
    for (const k in rec) writer.setStyle(node.id, k, String(rec[k]));
    for (const k in prec) if (!(k in rec)) writer.removeStyle(node.id, k);
    return;
  }
  if (name === "textContent") {
    writer.setText(node.id, String(value));
    return;
  }
  if (name.startsWith("on") && typeof value === "function") {
    const t = EVENT_CODE[name.slice(2).toLowerCase() as EventType] ?? 1;
    writer.addEventListener(node.id, t);
    const slot = node.id & 0xfffff;
    let m = listenersBySlot[slot];
    if (!m) {
      m = new Map();
      listenersBySlot[slot] = m;
    }
    m.set(t, value as (e: unknown) => void);
    return;
  }
  writer.setAttribute(node.id, name, String(value));
}

// ---------------------------------------------------------------------------
// The single renderer + shared writer. Module-level so the named exports
// consumed by compiled JSX are available at load time.
// ---------------------------------------------------------------------------

const writer = new Writer();

const renderer = solidCreateRenderer<Handle>({
  createElement(tag) {
    const h = makeHandle(tag);
    writer.createElement(h.id, tag);
    return h;
  },
  createTextNode(value) {
    const h = makeHandle("#text");
    writer.createText(h.id, value);
    return h;
  },
  replaceText(textNode, value) {
    writer.setText(textNode.id, value);
  },
  isTextNode(node) {
    return node.tag === "#text";
  },
  setProperty(node, name, value, prev) {
    applyProperty(writer, node, name, value, prev);
  },
  insertNode(parent, node, anchor) {
    if (node.parent) {
      unlinkChild(node.parent, node);
    }
    if (anchor) {
      linkChild(parent, node, anchor);
      writer.insertBefore(parent.id, node.id, anchor.id);
    } else {
      linkChild(parent, node, null);
      writer.appendChild(parent.id, node.id);
    }
  },
  removeNode(parent, node) {
    unlinkChild(parent, node);
    writer.removeChild(parent.id, node.id);
    sweepSet.add(node);
  },
  getParentNode(node) {
    return node.parent ?? undefined;
  },
  getFirstChild(node) {
    return node.firstChild ?? undefined;
  },
  getNextSibling(node) {
    return node.next ?? undefined;
  },
});

// Re-exported for the app's host glue (render entry + writer flush).
export { writer };
export const render = renderer.render as any as (
  code: () => JSX.Element,
  node: Handle,
) => () => void;

// Re-exported because compiled universal JSX imports these from this module.
export const createElement = renderer.createElement;
export const createTextNode = renderer.createTextNode;
export const insertNode = renderer.insertNode;
export const insert = renderer.insert;
export const setProp = renderer.setProp;
export const createComponent = renderer.createComponent;
export const effect = renderer.effect;
export const memo = renderer.memo;
export const spread = renderer.spread;
export const mergeProps = renderer.mergeProps;
export const use = renderer.use;

export function Dynamic(props: any) {
  const [local, others] = splitProps(props, ["component"]);
  const cached = createMemo(() => local.component);

  return createMemo(() => {
    const component = cached();
    switch (typeof component) {
      case "function":
        return untrack(() => component(others));
      case "string":
        const el = createElement(component);
        spread(el, others, false);
        return el;
    }
    return null;
  });
}

/** Register the root mount handle so bubbling reaches window-level listeners. */
export function registerRoot(root: Handle): void {
  if (typeof WeakRef !== "undefined") {
    nodesBySlot[root.id & 0xfffff] = new WeakRef(root);
  }
}

/**
 * Dispatch a DOM event from the host. Walks the Solid Handle tree upward from
 * the target (bubbling), firing any matching listener. The handler receives a
 * DOM-like event object built from `payloadJson`. stopPropagation() halts the
 * walk. A pointerup also synthesizes a `click` (browser semantics).
 */
export function dispatchEvent(
  solidId: number,
  eventCode: number,
  payloadStr: string,
): void {
  let data: Record<string, unknown> = {};
  if (payloadStr) {
    try {
      data = JSON.parse(payloadStr);
    } catch {
      /* ignore malformed */
    }
  } else {
    const ed = (globalThis as any).__blitz_event_data as
      | Float64Array
      | undefined;
    if (ed) {
      if (
        eventCode === EVENT_CODE.pointerup ||
        eventCode === EVENT_CODE.pointerdown ||
        eventCode === EVENT_CODE.pointermove ||
        eventCode === EVENT_CODE.click
      ) {
        data.clientX = ed[0];
        data.clientY = ed[1];
        data.button = ed[2];
        data.buttons = ed[3];
        data.mods = ed[4];
      } else if (eventCode === EVENT_CODE.wheel) {
        data.clientX = ed[0];
        data.clientY = ed[1];
        data.deltaX = ed[5];
        data.deltaY = ed[6];
      }
    }
  }

  let stopped = false;
  const ev = {
    target: { id: solidId, ...data },
    currentTarget: { id: solidId, ...data },
    type: eventName(eventCode),
    ...data,
    stopPropagation() {
      stopped = true;
    },
    preventDefault() {
      /* no default actions wired yet */
    },
    get defaultPrevented() {
      return false;
    },
    get propagationStopped() {
      return stopped;
    },
  };

  bubble(solidId, eventCode, ev);

  if (eventCode === EVENT_CODE.pointerup) {
    ev.type = eventName(EVENT_CODE.click);
    ev.stopPropagation = () => {
      stopped = true;
    };
    stopped = false; // Reset for the click event
    bubble(solidId, EVENT_CODE.click, ev);
  }
}

/** Walk parent chain from `nodeId`, firing `code` listeners until stopped. */
function bubble(nodeId: number, code: number, ev: any): void {
  let cur: number | null = nodeId;
  while (cur != null) {
    const slot: number = cur & 0xfffff;
    ev.currentTarget = cur === nodeId ? ev.target : { id: cur };
    const m = listenersBySlot[slot];
    const fn = m?.get(code);
    if (fn) {
      try {
        fn(ev);
      } catch (e) {
        __host_log(String(e));
      }
    }
    if (ev.propagationStopped) return;
    const weakHandle = nodesBySlot[slot] as any;
    const handle =
      weakHandle instanceof WeakRef ? weakHandle.deref() : weakHandle;
    cur = (handle as Handle | undefined)?.parent?.id ?? null;
  }
}

/** event code -> DOM event name (for ev.type). */
function eventName(code: number): string {
  for (const [name, c] of Object.entries(EVENT_CODE)) {
    if (c === code) return name;
  }
  return "unknown";
}

export type { JSX, Writer };
export { EVENT_CODE, OP };
