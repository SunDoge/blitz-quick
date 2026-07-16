var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
(function() {
  "use strict";
  const OP = {
    CreateElement: 1,
    CreateText: 2,
    CreateComment: 3,
    AppendChild: 4,
    InsertBefore: 5,
    RemoveChild: 6,
    ReplaceNode: 7,
    SetText: 8,
    SetAttribute: 9,
    RemoveAttribute: 10,
    SetStyle: 11,
    RemoveStyle: 12,
    AddEventListener: 13,
    RemoveEventListener: 14,
    SetClassName: 15,
    FrameEnd: 16,
    DropNode: 17
  };
  const EVENT_CODE = {
    click: 1,
    input: 2,
    submit: 3,
    keydown: 4,
    keyup: 5,
    change: 6,
    pointerdown: 7,
    pointermove: 8,
    pointerup: 9,
    pointerenter: 10,
    pointerleave: 11,
    wheel: 12,
    focus: 13,
    blur: 14,
    imecommit: 15,
    pointercancel: 16,
    pointerover: 17,
    pointerout: 18,
    contextmenu: 19,
    dblclick: 20,
    focusin: 21,
    focusout: 22,
    scroll: 23
  };
  const EVENT_DATA_SLOT = {
    clientX: 0,
    clientY: 1,
    button: 2,
    buttons: 3,
    mods: 4,
    deltaX: 5,
    deltaY: 6
  };
  Object.keys(EVENT_DATA_SLOT).length;
  let encoder;
  function utf8Encode(s) {
    if (encoder === void 0) {
      encoder = typeof TextEncoder !== "undefined" ? new TextEncoder() : null;
    }
    if (encoder) return encoder.encode(s);
    const out = [];
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c < 128) out.push(c);
      else if (c < 2048) out.push(192 | c >> 6, 128 | c & 63);
      else if (c >= 55296 && c <= 56319) {
        const c2 = s.charCodeAt(++i);
        const cp = 65536 + ((c & 1023) << 10) + (c2 & 63);
        out.push(
          240 | cp >> 18,
          128 | cp >> 12 & 63,
          128 | cp >> 6 & 63,
          128 | cp & 63
        );
      } else {
        out.push(224 | c >> 12, 128 | c >> 6 & 63, 128 | c & 63);
      }
    }
    return new Uint8Array(out);
  }
  class Writer {
    constructor() {
      __publicField(this, "buf", new Uint8Array(4096));
      __publicField(this, "cursor", 6);
      // Reserve first 6 bytes for header
      __publicField(this, "count", 0);
      __publicField(this, "seq", 0);
    }
    ensure(n) {
      if (this.cursor + n <= this.buf.length) return;
      let cap = this.buf.length;
      while (cap < this.cursor + n) cap *= 2;
      const next = new Uint8Array(cap);
      next.set(this.buf);
      this.buf = next;
    }
    u8(v) {
      this.ensure(1);
      this.buf[this.cursor++] = v & 255;
    }
    u16(v) {
      this.ensure(2);
      const c = this.cursor;
      this.buf[c] = v & 255;
      this.buf[c + 1] = v >> 8 & 255;
      this.cursor += 2;
    }
    u32(v) {
      this.ensure(4);
      const c = this.cursor;
      this.buf[c] = v & 255;
      this.buf[c + 1] = v >> 8 & 255;
      this.buf[c + 2] = v >> 16 & 255;
      this.buf[c + 3] = v >> 24 & 255;
      this.cursor += 4;
    }
    str(s) {
      const bytes = utf8Encode(s);
      if (bytes.length > 65535) {
        throw new RangeError(
          `protocol string is ${bytes.length} bytes; maximum is 65535`
        );
      }
      this.u16(bytes.length);
      this.ensure(bytes.length);
      this.buf.set(bytes, this.cursor);
      this.cursor += bytes.length;
    }
    emit(op) {
      if (this.count === 65535) {
        throw new RangeError("protocol frame cannot contain more than 65535 ops");
      }
      this.u8(op);
      this.count++;
    }
    createElement(id, tag, attrs = null) {
      if (attrs && attrs.length > 65535) {
        throw new RangeError("element cannot contain more than 65535 attributes");
      }
      this.emit(OP.CreateElement);
      this.u32(id);
      this.str(tag);
      this.u16(attrs ? attrs.length : 0);
      if (attrs)
        for (const [n, v] of attrs) {
          this.str(n);
          this.str(v);
        }
    }
    createText(id, text) {
      this.emit(OP.CreateText);
      this.u32(id);
      this.str(text);
    }
    createComment(id, text) {
      this.emit(OP.CreateComment);
      this.u32(id);
      this.str(text);
    }
    appendChild(parent, child) {
      this.emit(OP.AppendChild);
      this.u32(parent);
      this.u32(child);
    }
    insertBefore(parent, child, ref) {
      this.emit(OP.InsertBefore);
      this.u32(parent);
      this.u32(child);
      this.u32(ref);
    }
    removeChild(parent, child) {
      this.emit(OP.RemoveChild);
      this.u32(parent);
      this.u32(child);
    }
    replaceNode(parent, oldId, newId2) {
      this.emit(OP.ReplaceNode);
      this.u32(parent);
      this.u32(oldId);
      this.u32(newId2);
    }
    setText(id, text) {
      this.emit(OP.SetText);
      this.u32(id);
      this.str(text);
    }
    setAttribute(id, name, value) {
      this.emit(OP.SetAttribute);
      this.u32(id);
      this.str(name);
      this.str(value);
    }
    removeAttribute(id, name) {
      this.emit(OP.RemoveAttribute);
      this.u32(id);
      this.str(name);
    }
    setStyle(id, prop, value) {
      this.emit(OP.SetStyle);
      this.u32(id);
      this.str(prop);
      this.str(value);
    }
    removeStyle(id, prop) {
      this.emit(OP.RemoveStyle);
      this.u32(id);
      this.str(prop);
    }
    addEventListener(id, eventCode) {
      this.emit(OP.AddEventListener);
      this.u32(id);
      this.u8(eventCode);
    }
    removeEventListener(id, eventCode) {
      this.emit(OP.RemoveEventListener);
      this.u32(id);
      this.u8(eventCode);
    }
    setClassName(id, value) {
      this.emit(OP.SetClassName);
      this.u32(id);
      this.str(value);
    }
    frameEnd() {
      this.emit(OP.FrameEnd);
    }
    dropNode(id) {
      this.emit(OP.DropNode);
      this.u32(id);
    }
    /** Drain the buffer into a frame, or null if no ops were emitted this tick. */
    flush() {
      if (this.count === 0) return null;
      this.seq++;
      const s = this.seq;
      this.buf[0] = s & 255;
      this.buf[1] = s >> 8 & 255;
      this.buf[2] = s >> 16 & 255;
      this.buf[3] = s >> 24 & 255;
      this.buf[4] = this.count & 255;
      this.buf[5] = this.count >> 8 & 255;
      const out = this.buf.subarray(0, this.cursor);
      this.cursor = 6;
      this.count = 0;
      return out;
    }
  }
  const IS_DEV = false;
  const equalFn = (a, b) => a === b;
  const $PROXY = Symbol("solid-proxy");
  const SUPPORTS_PROXY = typeof Proxy === "function";
  const $TRACK = Symbol("solid-track");
  const signalOptions = {
    equals: equalFn
  };
  let runEffects = runQueue;
  const STALE = 1;
  const PENDING = 2;
  const UNOWNED = {
    owned: null,
    cleanups: null,
    context: null,
    owner: null
  };
  var Owner = null;
  let Transition = null;
  let ExternalSourceConfig = null;
  let Listener = null;
  let Updates = null;
  let Effects = null;
  let ExecCount = 0;
  function createRoot(fn, detachedOwner) {
    const listener = Listener, owner = Owner, unowned = fn.length === 0, current = owner, root = unowned ? UNOWNED : {
      owned: null,
      cleanups: null,
      context: current ? current.context : null,
      owner: current
    }, updateFn = unowned ? fn : () => fn(() => untrack(() => cleanNode(root)));
    Owner = root;
    Listener = null;
    try {
      return runUpdates(updateFn, true);
    } finally {
      Listener = listener;
      Owner = owner;
    }
  }
  function createSignal(value, options) {
    options = options ? Object.assign({}, signalOptions, options) : signalOptions;
    const s = {
      value,
      observers: null,
      observerSlots: null,
      comparator: options.equals || void 0
    };
    const setter = (value2) => {
      if (typeof value2 === "function") {
        value2 = value2(s.value);
      }
      return writeSignal(s, value2);
    };
    return [readSignal.bind(s), setter];
  }
  function createRenderEffect(fn, value, options) {
    const c = createComputation(fn, value, false, STALE);
    updateComputation(c);
  }
  function createEffect(fn, value, options) {
    runEffects = runUserEffects;
    const c = createComputation(fn, value, false, STALE);
    c.user = true;
    Effects ? Effects.push(c) : updateComputation(c);
  }
  function createMemo(fn, value, options) {
    options = options ? Object.assign({}, signalOptions, options) : signalOptions;
    const c = createComputation(fn, value, true, 0);
    c.observers = null;
    c.observerSlots = null;
    c.comparator = options.equals || void 0;
    updateComputation(c);
    return readSignal.bind(c);
  }
  function batch(fn) {
    return runUpdates(fn, false);
  }
  function untrack(fn) {
    if (Listener === null) return fn();
    const listener = Listener;
    Listener = null;
    try {
      if (ExternalSourceConfig) ;
      return fn();
    } finally {
      Listener = listener;
    }
  }
  function on(deps, fn, options) {
    const isArray = Array.isArray(deps);
    let prevInput;
    let defer = options && options.defer;
    return (prevValue) => {
      let input;
      if (isArray) {
        input = Array(deps.length);
        for (let i = 0; i < deps.length; i++) input[i] = deps[i]();
      } else input = deps();
      if (defer) {
        defer = false;
        return prevValue;
      }
      const result = untrack(() => fn(input, prevInput, prevValue));
      prevInput = input;
      return result;
    };
  }
  function onMount(fn) {
    createEffect(() => untrack(fn));
  }
  function onCleanup(fn) {
    if (Owner === null) ;
    else if (Owner.cleanups === null) Owner.cleanups = [fn];
    else Owner.cleanups.push(fn);
    return fn;
  }
  function getOwner() {
    return Owner;
  }
  function runWithOwner(o, fn) {
    const prev = Owner;
    const prevListener = Listener;
    Owner = o;
    Listener = null;
    try {
      return runUpdates(fn, true);
    } catch (err) {
      handleError(err);
    } finally {
      Owner = prev;
      Listener = prevListener;
    }
  }
  function startTransition(fn) {
    const l = Listener;
    const o = Owner;
    return Promise.resolve().then(() => {
      Listener = l;
      Owner = o;
      let t;
      runUpdates(fn, false);
      Listener = Owner = null;
      return t ? t.done : void 0;
    });
  }
  const [transPending, setTransPending] = /* @__PURE__ */ createSignal(false);
  function createContext(defaultValue, options) {
    const id = Symbol("context");
    return {
      id,
      Provider: createProvider(id),
      defaultValue
    };
  }
  function useContext(context) {
    let value;
    return Owner && Owner.context && (value = Owner.context[context.id]) !== void 0 ? value : context.defaultValue;
  }
  function children(fn) {
    const children2 = createMemo(fn);
    const memo2 = createMemo(() => resolveChildren(children2()));
    memo2.toArray = () => {
      const c = memo2();
      return Array.isArray(c) ? c : c != null ? [c] : [];
    };
    return memo2;
  }
  function readSignal() {
    if (this.sources && this.state) {
      if (this.state === STALE) updateComputation(this);
      else {
        const updates = Updates;
        Updates = null;
        runUpdates(() => lookUpstream(this), false);
        Updates = updates;
      }
    }
    if (Listener) {
      const observers = this.observers;
      if (!observers || observers[observers.length - 1] !== Listener) {
        const sSlot = observers ? observers.length : 0;
        if (!Listener.sources) {
          Listener.sources = [this];
          Listener.sourceSlots = [sSlot];
        } else {
          Listener.sources.push(this);
          Listener.sourceSlots.push(sSlot);
        }
        if (!observers) {
          this.observers = [Listener];
          this.observerSlots = [Listener.sources.length - 1];
        } else {
          observers.push(Listener);
          this.observerSlots.push(Listener.sources.length - 1);
        }
      }
    }
    return this.value;
  }
  function writeSignal(node, value, isComp) {
    let current = node.value;
    if (!node.comparator || !node.comparator(current, value)) {
      node.value = value;
      if (node.observers && node.observers.length) {
        runUpdates(() => {
          for (let i = 0; i < node.observers.length; i += 1) {
            const o = node.observers[i];
            const TransitionRunning = Transition && Transition.running;
            if (TransitionRunning && Transition.disposed.has(o)) ;
            if (TransitionRunning ? !o.tState : !o.state) {
              if (o.pure) Updates.push(o);
              else Effects.push(o);
              if (o.observers) markDownstream(o);
            }
            if (!TransitionRunning) o.state = STALE;
          }
          if (Updates.length > 1e6) {
            Updates = [];
            if (IS_DEV) ;
            throw new Error();
          }
        }, false);
      }
    }
    return value;
  }
  function updateComputation(node) {
    if (!node.fn) return;
    cleanNode(node);
    const time = ExecCount;
    runComputation(node, node.value, time);
  }
  function runComputation(node, value, time) {
    let nextValue;
    const owner = Owner, listener = Listener;
    Listener = Owner = node;
    try {
      nextValue = node.fn(value);
    } catch (err) {
      if (node.pure) {
        {
          node.state = STALE;
          node.owned && node.owned.forEach(cleanNode);
          node.owned = null;
        }
      }
      node.updatedAt = time + 1;
      return handleError(err);
    } finally {
      Listener = listener;
      Owner = owner;
    }
    if (!node.updatedAt || node.updatedAt <= time) {
      if (node.updatedAt != null && "observers" in node) {
        writeSignal(node, nextValue);
      } else node.value = nextValue;
      node.updatedAt = time;
    }
  }
  function createComputation(fn, init, pure, state = STALE, options) {
    const c = {
      fn,
      state,
      updatedAt: null,
      owned: null,
      sources: null,
      sourceSlots: null,
      cleanups: null,
      value: init,
      owner: Owner,
      context: Owner ? Owner.context : null,
      pure
    };
    if (Owner === null) ;
    else if (Owner !== UNOWNED) {
      {
        if (!Owner.owned) Owner.owned = [c];
        else Owner.owned.push(c);
      }
    }
    return c;
  }
  function runTop(node) {
    if (node.state === 0) return;
    if (node.state === PENDING) return lookUpstream(node);
    if (node.suspense && untrack(node.suspense.inFallback)) return node.suspense.effects.push(node);
    const ancestors = [node];
    while ((node = node.owner) && (!node.updatedAt || node.updatedAt < ExecCount)) {
      if (node.state) ancestors.push(node);
    }
    for (let i = ancestors.length - 1; i >= 0; i--) {
      node = ancestors[i];
      if (node.state === STALE) {
        updateComputation(node);
      } else if (node.state === PENDING) {
        const updates = Updates;
        Updates = null;
        runUpdates(() => lookUpstream(node, ancestors[0]), false);
        Updates = updates;
      }
    }
  }
  function runUpdates(fn, init) {
    if (Updates) return fn();
    let wait = false;
    if (!init) Updates = [];
    if (Effects) wait = true;
    else Effects = [];
    ExecCount++;
    try {
      const res = fn();
      completeUpdates(wait);
      return res;
    } catch (err) {
      if (!wait) Effects = null;
      Updates = null;
      handleError(err);
    }
  }
  function completeUpdates(wait) {
    if (Updates) {
      runQueue(Updates);
      Updates = null;
    }
    if (wait) return;
    const e = Effects;
    Effects = null;
    if (e.length) runUpdates(() => runEffects(e), false);
  }
  function runQueue(queue) {
    for (let i = 0; i < queue.length; i++) runTop(queue[i]);
  }
  function runUserEffects(queue) {
    let i, userLength = 0;
    for (i = 0; i < queue.length; i++) {
      const e = queue[i];
      if (!e.user) runTop(e);
      else queue[userLength++] = e;
    }
    for (i = 0; i < userLength; i++) runTop(queue[i]);
  }
  function lookUpstream(node, ignore) {
    node.state = 0;
    for (let i = 0; i < node.sources.length; i += 1) {
      const source = node.sources[i];
      if (source.sources) {
        const state = source.state;
        if (state === STALE) {
          if (source !== ignore && (!source.updatedAt || source.updatedAt < ExecCount)) runTop(source);
        } else if (state === PENDING) lookUpstream(source, ignore);
      }
    }
  }
  function markDownstream(node) {
    for (let i = 0; i < node.observers.length; i += 1) {
      const o = node.observers[i];
      if (!o.state) {
        o.state = PENDING;
        if (o.pure) Updates.push(o);
        else Effects.push(o);
        o.observers && markDownstream(o);
      }
    }
  }
  function cleanNode(node) {
    let i;
    if (node.sources) {
      while (node.sources.length) {
        const source = node.sources.pop(), index = node.sourceSlots.pop(), obs = source.observers;
        if (obs && obs.length) {
          const n = obs.pop(), s = source.observerSlots.pop();
          if (index < obs.length) {
            n.sourceSlots[s] = index;
            obs[index] = n;
            source.observerSlots[index] = s;
          }
        }
      }
    }
    if (node.tOwned) {
      for (i = node.tOwned.length - 1; i >= 0; i--) cleanNode(node.tOwned[i]);
      delete node.tOwned;
    }
    if (node.owned) {
      for (i = node.owned.length - 1; i >= 0; i--) cleanNode(node.owned[i]);
      node.owned = null;
    }
    if (node.cleanups) {
      for (i = node.cleanups.length - 1; i >= 0; i--) node.cleanups[i]();
      node.cleanups = null;
    }
    node.state = 0;
  }
  function castError(err) {
    if (err instanceof Error) return err;
    return new Error(typeof err === "string" ? err : "Unknown error", {
      cause: err
    });
  }
  function handleError(err, owner = Owner) {
    const error = castError(err);
    throw error;
  }
  function resolveChildren(children2) {
    if (typeof children2 === "function" && !children2.length) return resolveChildren(children2());
    if (Array.isArray(children2)) {
      const results = [];
      for (let i = 0; i < children2.length; i++) {
        const result = resolveChildren(children2[i]);
        if (Array.isArray(result)) {
          if (result.length < 32768) results.push.apply(results, result);
          else for (let j = 0; j < result.length; j++) results.push(result[j]);
        } else {
          results.push(result);
        }
      }
      return results;
    }
    return children2;
  }
  function createProvider(id, options) {
    return function provider(props) {
      let res;
      createRenderEffect(() => res = untrack(() => {
        Owner.context = {
          ...Owner.context,
          [id]: props.value
        };
        return children(() => props.children);
      }), void 0);
      return res;
    };
  }
  const FALLBACK = Symbol("fallback");
  function dispose(d) {
    for (let i = 0; i < d.length; i++) d[i]();
  }
  function mapArray(list, mapFn, options = {}) {
    let items = [], mapped = [], disposers = [], len = 0, indexes = mapFn.length > 1 ? [] : null;
    onCleanup(() => dispose(disposers));
    return () => {
      let newItems = list() || [], newLen = newItems.length, i, j;
      newItems[$TRACK];
      return untrack(() => {
        let newIndices, newIndicesNext, temp, tempdisposers, tempIndexes, start, end, newEnd, item;
        if (newLen === 0) {
          if (len !== 0) {
            dispose(disposers);
            disposers = [];
            items = [];
            mapped = [];
            len = 0;
            indexes && (indexes = []);
          }
          if (options.fallback) {
            items = [FALLBACK];
            mapped[0] = createRoot((disposer) => {
              disposers[0] = disposer;
              return options.fallback();
            });
            len = 1;
          }
        } else if (len === 0) {
          mapped = new Array(newLen);
          for (j = 0; j < newLen; j++) {
            items[j] = newItems[j];
            mapped[j] = createRoot(mapper);
          }
          len = newLen;
        } else {
          temp = new Array(newLen);
          tempdisposers = new Array(newLen);
          indexes && (tempIndexes = new Array(newLen));
          for (start = 0, end = Math.min(len, newLen); start < end && items[start] === newItems[start]; start++) ;
          for (end = len - 1, newEnd = newLen - 1; end >= start && newEnd >= start && items[end] === newItems[newEnd]; end--, newEnd--) {
            temp[newEnd] = mapped[end];
            tempdisposers[newEnd] = disposers[end];
            indexes && (tempIndexes[newEnd] = indexes[end]);
          }
          newIndices = /* @__PURE__ */ new Map();
          newIndicesNext = new Array(newEnd + 1);
          for (j = newEnd; j >= start; j--) {
            item = newItems[j];
            i = newIndices.get(item);
            newIndicesNext[j] = i === void 0 ? -1 : i;
            newIndices.set(item, j);
          }
          for (i = start; i <= end; i++) {
            item = items[i];
            j = newIndices.get(item);
            if (j !== void 0 && j !== -1) {
              temp[j] = mapped[i];
              tempdisposers[j] = disposers[i];
              indexes && (tempIndexes[j] = indexes[i]);
              j = newIndicesNext[j];
              newIndices.set(item, j);
            } else disposers[i]();
          }
          for (j = start; j < newLen; j++) {
            if (j in temp) {
              mapped[j] = temp[j];
              disposers[j] = tempdisposers[j];
              if (indexes) {
                indexes[j] = tempIndexes[j];
                indexes[j](j);
              }
            } else mapped[j] = createRoot(mapper);
          }
          mapped = mapped.slice(0, len = newLen);
          items = newItems.slice(0);
        }
        return mapped;
      });
      function mapper(disposer) {
        disposers[j] = disposer;
        if (indexes) {
          const [s, set] = createSignal(j);
          indexes[j] = set;
          return mapFn(newItems[j], s);
        }
        return mapFn(newItems[j]);
      }
    };
  }
  function createComponent$1(Comp, props) {
    return untrack(() => Comp(props || {}));
  }
  function trueFn() {
    return true;
  }
  const propTraps = {
    get(_, property, receiver) {
      if (property === $PROXY) return receiver;
      return _.get(property);
    },
    has(_, property) {
      if (property === $PROXY) return true;
      return _.has(property);
    },
    set: trueFn,
    deleteProperty: trueFn,
    getOwnPropertyDescriptor(_, property) {
      return {
        configurable: true,
        enumerable: true,
        get() {
          return _.get(property);
        },
        set: trueFn,
        deleteProperty: trueFn
      };
    },
    ownKeys(_) {
      return _.keys();
    }
  };
  function resolveSource(s) {
    return !(s = typeof s === "function" ? s() : s) ? {} : s;
  }
  function resolveSources() {
    for (let i = 0, length = this.length; i < length; ++i) {
      const v = this[i]();
      if (v !== void 0) return v;
    }
  }
  function mergeProps$1(...sources) {
    let proxy = false;
    for (let i = 0; i < sources.length; i++) {
      const s = sources[i];
      proxy = proxy || !!s && $PROXY in s;
      sources[i] = typeof s === "function" ? (proxy = true, createMemo(s)) : s;
    }
    if (SUPPORTS_PROXY && proxy) {
      return new Proxy({
        get(property) {
          for (let i = sources.length - 1; i >= 0; i--) {
            const v = resolveSource(sources[i])[property];
            if (v !== void 0) return v;
          }
        },
        has(property) {
          for (let i = sources.length - 1; i >= 0; i--) {
            if (property in resolveSource(sources[i])) return true;
          }
          return false;
        },
        keys() {
          const keys = [];
          for (let i = 0; i < sources.length; i++) keys.push(...Object.keys(resolveSource(sources[i])));
          return [...new Set(keys)];
        }
      }, propTraps);
    }
    const sourcesMap = {};
    const defined = /* @__PURE__ */ Object.create(null);
    for (let i = sources.length - 1; i >= 0; i--) {
      const source = sources[i];
      if (!source) continue;
      const sourceKeys = Object.getOwnPropertyNames(source);
      for (let i2 = sourceKeys.length - 1; i2 >= 0; i2--) {
        const key = sourceKeys[i2];
        if (key === "__proto__" || key === "constructor") continue;
        const desc = Object.getOwnPropertyDescriptor(source, key);
        if (!defined[key]) {
          defined[key] = desc.get ? {
            enumerable: true,
            configurable: true,
            get: resolveSources.bind(sourcesMap[key] = [desc.get.bind(source)])
          } : desc.value !== void 0 ? desc : void 0;
        } else {
          const sources2 = sourcesMap[key];
          if (sources2) {
            if (desc.get) sources2.push(desc.get.bind(source));
            else if (desc.value !== void 0) sources2.push(() => desc.value);
          }
        }
      }
    }
    const target = {};
    const definedKeys = Object.keys(defined);
    for (let i = definedKeys.length - 1; i >= 0; i--) {
      const key = definedKeys[i], desc = defined[key];
      if (desc && desc.get) Object.defineProperty(target, key, desc);
      else target[key] = desc ? desc.value : void 0;
    }
    return target;
  }
  function splitProps(props, ...keys) {
    const len = keys.length;
    if (SUPPORTS_PROXY && $PROXY in props) {
      const blocked = len > 1 ? keys.flat() : keys[0];
      const res = keys.map((k) => {
        return new Proxy({
          get(property) {
            return k.includes(property) ? props[property] : void 0;
          },
          has(property) {
            return k.includes(property) && property in props;
          },
          keys() {
            return k.filter((property) => property in props);
          }
        }, propTraps);
      });
      res.push(new Proxy({
        get(property) {
          return blocked.includes(property) ? void 0 : props[property];
        },
        has(property) {
          return blocked.includes(property) ? false : property in props;
        },
        keys() {
          return Object.keys(props).filter((k) => !blocked.includes(k));
        }
      }, propTraps));
      return res;
    }
    const objects = [];
    for (let i = 0; i <= len; i++) {
      objects[i] = {};
    }
    for (const propName of Object.getOwnPropertyNames(props)) {
      let keyIndex = len;
      for (let i = 0; i < keys.length; i++) {
        if (keys[i].includes(propName)) {
          keyIndex = i;
          break;
        }
      }
      const desc = Object.getOwnPropertyDescriptor(props, propName);
      const isDefaultDesc = !desc.get && !desc.set && desc.enumerable && desc.writable && desc.configurable;
      isDefaultDesc ? objects[keyIndex][propName] = desc.value : Object.defineProperty(objects[keyIndex], propName, desc);
    }
    return objects;
  }
  const narrowedError = (name) => `Stale read from <${name}>.`;
  function For(props) {
    const fallback = "fallback" in props && {
      fallback: () => props.fallback
    };
    return createMemo(mapArray(() => props.each, props.children, fallback || void 0));
  }
  function Show(props) {
    const keyed = props.keyed;
    const conditionValue = createMemo(() => props.when, void 0, void 0);
    const condition = keyed ? conditionValue : createMemo(conditionValue, void 0, {
      equals: (a, b) => !a === !b
    });
    return createMemo(() => {
      const c = condition();
      if (c) {
        const child = props.children;
        const fn = typeof child === "function" && child.length > 0;
        return fn ? untrack(() => child(keyed ? c : () => {
          if (!untrack(condition)) throw narrowedError("Show");
          return conditionValue();
        })) : child;
      }
      return props.fallback;
    }, void 0, void 0);
  }
  const memo$1 = (fn) => createMemo(() => fn());
  function createRenderer$1({
    createElement: createElement2,
    createTextNode: createTextNode2,
    isTextNode,
    replaceText,
    insertNode: insertNode2,
    removeNode,
    setProperty,
    getParentNode,
    getFirstChild,
    getNextSibling
  }) {
    function insert2(parent, accessor, marker, initial) {
      if (marker !== void 0 && !initial) initial = [];
      if (typeof accessor !== "function") return insertExpression(parent, accessor, initial, marker);
      createRenderEffect((current) => insertExpression(parent, accessor(), current, marker), initial);
    }
    function insertExpression(parent, value, current, marker, unwrapArray) {
      while (typeof current === "function") current = current();
      if (value === current) return current;
      const t = typeof value, multi = marker !== void 0;
      if (t === "string" || t === "number") {
        if (t === "number") value = value.toString();
        if (multi) {
          let node = current[0];
          if (node && isTextNode(node)) {
            replaceText(node, value);
          } else node = createTextNode2(value);
          current = cleanChildren(parent, current, marker, node);
        } else {
          if (current !== "" && typeof current === "string") {
            replaceText(getFirstChild(parent), current = value);
          } else {
            cleanChildren(parent, current, marker, createTextNode2(value));
            current = value;
          }
        }
      } else if (value == null || t === "boolean") {
        current = cleanChildren(parent, current, marker);
      } else if (t === "function") {
        createRenderEffect(() => {
          let v = value();
          while (typeof v === "function") v = v();
          current = insertExpression(parent, v, current, marker);
        });
        return () => current;
      } else if (Array.isArray(value)) {
        const array = [];
        if (normalizeIncomingArray(array, value, unwrapArray)) {
          createRenderEffect(() => current = insertExpression(parent, array, current, marker, true));
          return () => current;
        }
        if (array.length === 0) {
          const replacement = cleanChildren(parent, current, marker);
          if (multi) return current = replacement;
        } else {
          if (Array.isArray(current)) {
            if (current.length === 0) {
              appendNodes(parent, array, marker);
            } else reconcileArrays(parent, current, array);
          } else if (current == null || current === "") {
            appendNodes(parent, array);
          } else {
            reconcileArrays(parent, multi && current || [getFirstChild(parent)], array);
          }
        }
        current = array;
      } else {
        if (Array.isArray(current)) {
          if (multi) return current = cleanChildren(parent, current, marker, value);
          cleanChildren(parent, current, null, value);
        } else if (current == null || current === "" || !getFirstChild(parent)) {
          insertNode2(parent, value);
        } else replaceNode(parent, value, getFirstChild(parent));
        current = value;
      }
      return current;
    }
    function normalizeIncomingArray(normalized, array, unwrap) {
      let dynamic = false;
      for (let i = 0, len = array.length; i < len; i++) {
        let item = array[i], t;
        if (item == null || item === true || item === false) ;
        else if (Array.isArray(item)) {
          dynamic = normalizeIncomingArray(normalized, item) || dynamic;
        } else if ((t = typeof item) === "string" || t === "number") {
          normalized.push(createTextNode2(item));
        } else if (t === "function") {
          if (unwrap) {
            while (typeof item === "function") item = item();
            dynamic = normalizeIncomingArray(normalized, Array.isArray(item) ? item : [item]) || dynamic;
          } else {
            normalized.push(item);
            dynamic = true;
          }
        } else normalized.push(item);
      }
      return dynamic;
    }
    function reconcileArrays(parentNode, a, b) {
      let bLength = b.length, aEnd = a.length, bEnd = bLength, aStart = 0, bStart = 0, after = getNextSibling(a[aEnd - 1]), map = null;
      while (aStart < aEnd || bStart < bEnd) {
        if (a[aStart] === b[bStart]) {
          aStart++;
          bStart++;
          continue;
        }
        while (a[aEnd - 1] === b[bEnd - 1]) {
          aEnd--;
          bEnd--;
        }
        if (aEnd === aStart) {
          const node = bEnd < bLength ? bStart ? getNextSibling(b[bStart - 1]) : b[bEnd - bStart] : after;
          while (bStart < bEnd) insertNode2(parentNode, b[bStart++], node);
        } else if (bEnd === bStart) {
          while (aStart < aEnd) {
            if (!map || !map.has(a[aStart])) removeNode(parentNode, a[aStart]);
            aStart++;
          }
        } else if (a[aStart] === b[bEnd - 1] && b[bStart] === a[aEnd - 1]) {
          const node = getNextSibling(a[--aEnd]);
          insertNode2(parentNode, b[bStart++], getNextSibling(a[aStart++]));
          insertNode2(parentNode, b[--bEnd], node);
          a[aEnd] = b[bEnd];
        } else {
          if (!map) {
            map = /* @__PURE__ */ new Map();
            let i = bStart;
            while (i < bEnd) map.set(b[i], i++);
          }
          const index = map.get(a[aStart]);
          if (index != null) {
            if (bStart < index && index < bEnd) {
              let i = aStart, sequence = 1, t;
              while (++i < aEnd && i < bEnd) {
                if ((t = map.get(a[i])) == null || t !== index + sequence) break;
                sequence++;
              }
              if (sequence > index - bStart) {
                const node = a[aStart];
                while (bStart < index) insertNode2(parentNode, b[bStart++], node);
              } else replaceNode(parentNode, b[bStart++], a[aStart++]);
            } else aStart++;
          } else removeNode(parentNode, a[aStart++]);
        }
      }
    }
    function cleanChildren(parent, current, marker, replacement) {
      if (marker === void 0) {
        let removed;
        while (removed = getFirstChild(parent)) removeNode(parent, removed);
        replacement && insertNode2(parent, replacement);
        return "";
      }
      const node = replacement || createTextNode2("");
      if (current.length) {
        let inserted = false;
        for (let i = current.length - 1; i >= 0; i--) {
          const el = current[i];
          if (node !== el) {
            const isParent = getParentNode(el) === parent;
            if (!inserted && !i) isParent ? replaceNode(parent, node, el) : insertNode2(parent, node, marker);
            else isParent && removeNode(parent, el);
          } else inserted = true;
        }
      } else insertNode2(parent, node, marker);
      return [node];
    }
    function appendNodes(parent, array, marker) {
      for (let i = 0, len = array.length; i < len; i++) insertNode2(parent, array[i], marker);
    }
    function replaceNode(parent, newNode, oldNode) {
      insertNode2(parent, newNode, oldNode);
      removeNode(parent, oldNode);
    }
    function spreadExpression(node, props, prevProps = {}, skipChildren) {
      props || (props = {});
      if (!skipChildren) {
        createRenderEffect(() => prevProps.children = insertExpression(node, props.children, prevProps.children));
      }
      createRenderEffect(() => props.ref && props.ref(node));
      createRenderEffect(() => {
        for (const prop in props) {
          if (prop === "children" || prop === "ref") continue;
          const value = props[prop];
          if (value === prevProps[prop]) continue;
          setProperty(node, prop, value, prevProps[prop]);
          prevProps[prop] = value;
        }
      });
      return prevProps;
    }
    return {
      render(code, element) {
        let disposer;
        createRoot((dispose2) => {
          disposer = dispose2;
          insert2(element, code());
        });
        return disposer;
      },
      insert: insert2,
      spread(node, accessor, skipChildren) {
        if (typeof accessor === "function") {
          createRenderEffect((current) => spreadExpression(node, accessor(), current, skipChildren));
        } else spreadExpression(node, accessor, void 0, skipChildren);
      },
      createElement: createElement2,
      createTextNode: createTextNode2,
      insertNode: insertNode2,
      setProp(node, name, value, prev) {
        setProperty(node, name, value, prev);
        return value;
      },
      mergeProps: mergeProps$1,
      effect: createRenderEffect,
      memo: memo$1,
      createComponent: createComponent$1,
      use(fn, element, arg) {
        return untrack(() => fn(element, arg));
      }
    };
  }
  function createRenderer(options) {
    const renderer2 = createRenderer$1(options);
    renderer2.mergeProps = mergeProps$1;
    return renderer2;
  }
  const isServer = false;
  const getRequestEvent = () => void 0;
  const FREE_LIST = [];
  const GENERATIONS = [];
  let nextSlot = 2;
  const listenersBySlot = [];
  const nodesBySlot = [];
  const finalizationRegistry = typeof FinalizationRegistry !== "undefined" ? new FinalizationRegistry((id) => {
    const slot = id & 1048575;
    const expectedGen = id >>> 20;
    if (GENERATIONS[slot] !== expectedGen) return;
    nodesBySlot[slot] = void 0;
    listenersBySlot[slot] = void 0;
    writer.dropNode(id);
    freeId(id);
  }) : null;
  const sweepSet = /* @__PURE__ */ new Set();
  function runSweep() {
    if (sweepSet.size === 0) return;
    for (const node of sweepSet) {
      if (node.parent !== null) continue;
      const destroy = (n) => {
        const slot = n.id & 1048575;
        if (nodesBySlot[slot] === void 0) return;
        finalizationRegistry == null ? void 0 : finalizationRegistry.unregister(n);
        nodesBySlot[slot] = void 0;
        listenersBySlot[slot] = void 0;
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
  function newId() {
    let slot;
    if (FREE_LIST.length > 0) {
      slot = FREE_LIST.pop();
    } else {
      slot = nextSlot++;
      GENERATIONS[slot] = 0;
    }
    const gen = GENERATIONS[slot];
    return (gen << 20 | slot) >>> 0;
  }
  function freeId(id) {
    const slot = id & 1048575;
    GENERATIONS[slot] = GENERATIONS[slot] + 1 & 4095;
    FREE_LIST.push(slot);
  }
  function makeHandle(tag) {
    const id = newId();
    const h = {
      id,
      tag,
      parent: null,
      firstChild: null,
      lastChild: null,
      prev: null,
      next: null
    };
    if (typeof WeakRef !== "undefined") {
      nodesBySlot[id & 1048575] = new WeakRef(h);
    }
    if (finalizationRegistry) {
      finalizationRegistry.register(h, h.id, h);
    }
    return h;
  }
  function linkChild(parent, child, ref) {
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
  function unlinkChild(parent, child) {
    if (child.prev) child.prev.next = child.next;
    else parent.firstChild = child.next;
    if (child.next) child.next.prev = child.prev;
    else parent.lastChild = child.prev;
    child.parent = child.prev = child.next = null;
  }
  function applyProperty(writer2, node, name, value, prev) {
    var _a;
    if (value === prev) return;
    if (value == null || value === false) {
      if (name.startsWith("on") && name.length > 2) {
        const t = EVENT_CODE[name.slice(2).toLowerCase()] ?? null;
        if (t != null) {
          const slot = node.id & 1048575;
          writer2.removeEventListener(node.id, t);
          (_a = listenersBySlot[slot]) == null ? void 0 : _a.delete(t);
        }
        return;
      }
      writer2.removeAttribute(node.id, name);
      return;
    }
    if (name === "class" || name === "className") {
      writer2.setClassName(node.id, String(value));
      return;
    }
    if (name === "style" && typeof value === "object" && value !== null) {
      const rec = value;
      const prec = prev && typeof prev === "object" ? prev : {};
      for (const k in rec) writer2.setStyle(node.id, k, String(rec[k]));
      for (const k in prec) if (!(k in rec)) writer2.removeStyle(node.id, k);
      return;
    }
    if (name === "textContent") {
      writer2.setText(node.id, String(value));
      return;
    }
    if (name.startsWith("on") && typeof value === "function") {
      const t = EVENT_CODE[name.slice(2).toLowerCase()] ?? 1;
      writer2.addEventListener(node.id, t);
      const slot = node.id & 1048575;
      let m = listenersBySlot[slot];
      if (!m) {
        m = /* @__PURE__ */ new Map();
        listenersBySlot[slot] = m;
      }
      m.set(t, value);
      return;
    }
    writer2.setAttribute(node.id, name, String(value));
  }
  const writer = new Writer();
  const renderer = createRenderer({
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
      return node.parent ?? void 0;
    },
    getFirstChild(node) {
      return node.firstChild ?? void 0;
    },
    getNextSibling(node) {
      return node.next ?? void 0;
    }
  });
  const render = renderer.render;
  const createElement = renderer.createElement;
  const createTextNode = renderer.createTextNode;
  const insertNode = renderer.insertNode;
  const insert = renderer.insert;
  const setProp = renderer.setProp;
  const createComponent = renderer.createComponent;
  const effect = renderer.effect;
  const memo = renderer.memo;
  const spread = renderer.spread;
  const mergeProps = renderer.mergeProps;
  function Dynamic(props) {
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
  function registerRoot(root) {
    if (typeof WeakRef !== "undefined") {
      nodesBySlot[root.id & 1048575] = new WeakRef(root);
    }
  }
  function mount(code) {
    const root = {
      id: 1,
      tag: "#root",
      parent: null,
      firstChild: null,
      lastChild: null,
      prev: null,
      next: null
    };
    registerRoot(root);
    return render(code, root);
  }
  function dispatchEvent(solidId, eventCode, payloadStr) {
    let data = {};
    if (payloadStr) {
      try {
        data = JSON.parse(payloadStr);
      } catch {
      }
    } else {
      const ed = globalThis.__blitz_event_data;
      if (ed) {
        if (eventCode === EVENT_CODE.pointerup || eventCode === EVENT_CODE.pointerdown || eventCode === EVENT_CODE.pointermove || eventCode === EVENT_CODE.click) {
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
      },
      get defaultPrevented() {
        return false;
      },
      get propagationStopped() {
        return stopped;
      }
    };
    bubble(solidId, eventCode, ev);
    if (eventCode === EVENT_CODE.pointerup) {
      ev.type = eventName(EVENT_CODE.click);
      ev.stopPropagation = () => {
        stopped = true;
      };
      stopped = false;
      bubble(solidId, EVENT_CODE.click, ev);
    }
  }
  function bubble(nodeId, code, ev) {
    var _a;
    let cur = nodeId;
    while (cur != null) {
      const slot = cur & 1048575;
      ev.currentTarget = cur === nodeId ? ev.target : { id: cur };
      const m = listenersBySlot[slot];
      const fn = m == null ? void 0 : m.get(code);
      if (fn) {
        try {
          fn(ev);
        } catch (e) {
          __host_log(String(e));
        }
      }
      if (ev.propagationStopped) return;
      const weakHandle = nodesBySlot[slot];
      const handle = weakHandle instanceof WeakRef ? weakHandle.deref() : weakHandle;
      cur = ((_a = handle == null ? void 0 : handle.parent) == null ? void 0 : _a.id) ?? null;
    }
  }
  function eventName(code) {
    for (const [name, c] of Object.entries(EVENT_CODE)) {
      if (c === code) return name;
    }
    return "unknown";
  }
  var commonjsGlobal = typeof globalThis !== "undefined" ? globalThis : typeof window !== "undefined" ? window : typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : {};
  (function(global2) {
    var checkIfIteratorIsSupported = function() {
      try {
        return !!Symbol.iterator;
      } catch (error) {
        return false;
      }
    };
    var iteratorSupported = checkIfIteratorIsSupported();
    var createIterator = function(items) {
      var iterator = {
        next: function() {
          var value = items.shift();
          return { done: value === void 0, value };
        }
      };
      if (iteratorSupported) {
        iterator[Symbol.iterator] = function() {
          return iterator;
        };
      }
      return iterator;
    };
    var serializeParam = function(value) {
      return encodeURIComponent(value).replace(/%20/g, "+");
    };
    var deserializeParam = function(value) {
      return decodeURIComponent(String(value).replace(/\+/g, " "));
    };
    var polyfillURLSearchParams = function() {
      var URLSearchParams2 = function(searchString) {
        Object.defineProperty(this, "_entries", { writable: true, value: {} });
        var typeofSearchString = typeof searchString;
        if (typeofSearchString === "undefined") ;
        else if (typeofSearchString === "string") {
          if (searchString !== "") {
            this._fromString(searchString);
          }
        } else if (searchString instanceof URLSearchParams2) {
          var _this = this;
          searchString.forEach(function(value, name) {
            _this.append(name, value);
          });
        } else if (searchString !== null && typeofSearchString === "object") {
          if (Object.prototype.toString.call(searchString) === "[object Array]") {
            for (var i = 0; i < searchString.length; i++) {
              var entry = searchString[i];
              if (Object.prototype.toString.call(entry) === "[object Array]" || entry.length !== 2) {
                this.append(entry[0], entry[1]);
              } else {
                throw new TypeError("Expected [string, any] as entry at index " + i + " of URLSearchParams's input");
              }
            }
          } else {
            for (var key in searchString) {
              if (searchString.hasOwnProperty(key)) {
                this.append(key, searchString[key]);
              }
            }
          }
        } else {
          throw new TypeError("Unsupported input's type for URLSearchParams");
        }
      };
      var proto2 = URLSearchParams2.prototype;
      proto2.append = function(name, value) {
        if (name in this._entries) {
          this._entries[name].push(String(value));
        } else {
          this._entries[name] = [String(value)];
        }
      };
      proto2.delete = function(name) {
        delete this._entries[name];
      };
      proto2.get = function(name) {
        return name in this._entries ? this._entries[name][0] : null;
      };
      proto2.getAll = function(name) {
        return name in this._entries ? this._entries[name].slice(0) : [];
      };
      proto2.has = function(name) {
        return name in this._entries;
      };
      proto2.set = function(name, value) {
        this._entries[name] = [String(value)];
      };
      proto2.forEach = function(callback, thisArg) {
        var entries;
        for (var name in this._entries) {
          if (this._entries.hasOwnProperty(name)) {
            entries = this._entries[name];
            for (var i = 0; i < entries.length; i++) {
              callback.call(thisArg, entries[i], name, this);
            }
          }
        }
      };
      proto2.keys = function() {
        var items = [];
        this.forEach(function(value, name) {
          items.push(name);
        });
        return createIterator(items);
      };
      proto2.values = function() {
        var items = [];
        this.forEach(function(value) {
          items.push(value);
        });
        return createIterator(items);
      };
      proto2.entries = function() {
        var items = [];
        this.forEach(function(value, name) {
          items.push([name, value]);
        });
        return createIterator(items);
      };
      if (iteratorSupported) {
        proto2[Symbol.iterator] = proto2.entries;
      }
      proto2.toString = function() {
        var searchArray = [];
        this.forEach(function(value, name) {
          searchArray.push(serializeParam(name) + "=" + serializeParam(value));
        });
        return searchArray.join("&");
      };
      Object.defineProperty(proto2, "size", {
        get: function() {
          return this._entries ? Object.keys(this._entries).length : 0;
        }
      });
      global2.URLSearchParams = URLSearchParams2;
    };
    var checkIfURLSearchParamsSupported = function() {
      try {
        var URLSearchParams2 = global2.URLSearchParams;
        return new URLSearchParams2("?a=1").toString() === "a=1" && typeof URLSearchParams2.prototype.set === "function" && typeof URLSearchParams2.prototype.entries === "function";
      } catch (e) {
        return false;
      }
    };
    if (!checkIfURLSearchParamsSupported()) {
      polyfillURLSearchParams();
    }
    var proto = global2.URLSearchParams.prototype;
    if (typeof proto.sort !== "function") {
      proto.sort = function() {
        var _this = this;
        var items = [];
        this.forEach(function(value, name) {
          items.push([name, value]);
          if (!_this._entries) {
            _this.delete(name);
          }
        });
        items.sort(function(a, b) {
          if (a[0] < b[0]) {
            return -1;
          } else if (a[0] > b[0]) {
            return 1;
          } else {
            return 0;
          }
        });
        if (_this._entries) {
          _this._entries = {};
        }
        for (var i = 0; i < items.length; i++) {
          this.append(items[i][0], items[i][1]);
        }
      };
    }
    if (typeof proto._fromString !== "function") {
      Object.defineProperty(proto, "_fromString", {
        enumerable: false,
        configurable: false,
        writable: false,
        value: function(searchString) {
          if (this._entries) {
            this._entries = {};
          } else {
            var keys = [];
            this.forEach(function(value, name) {
              keys.push(name);
            });
            for (var i = 0; i < keys.length; i++) {
              this.delete(keys[i]);
            }
          }
          searchString = searchString.replace(/^\?/, "");
          var attributes = searchString.split("&");
          var attribute;
          for (var i = 0; i < attributes.length; i++) {
            attribute = attributes[i].split("=");
            this.append(
              deserializeParam(attribute[0]),
              attribute.length > 1 ? deserializeParam(attribute.slice(1).join("=")) : ""
            );
          }
        }
      });
    }
  })(
    typeof commonjsGlobal !== "undefined" ? commonjsGlobal : typeof window !== "undefined" ? window : typeof self !== "undefined" ? self : commonjsGlobal
  );
  (function(global2) {
    var checkIfURLIsSupported = function() {
      try {
        var u = new global2.URL("b", "http://a");
        u.pathname = "c d";
        return u.href === "http://a/c%20d" && u.searchParams;
      } catch (e) {
        return false;
      }
    };
    var polyfillURL = function() {
      var _URL = global2.URL;
      var URL2 = function(url, base) {
        if (typeof url !== "string") url = String(url);
        if (base && typeof base !== "string") base = String(base);
        var doc = document, baseElement;
        if (base && (global2.location === void 0 || base !== global2.location.href)) {
          var isIE11 = !!window.MSInputMethodContext && !!document.documentMode;
          if (isIE11) {
            base = base.toLowerCase();
          }
          doc = document.implementation.createHTMLDocument("");
          baseElement = doc.createElement("base");
          baseElement.href = base;
          doc.head.appendChild(baseElement);
          try {
            if (baseElement.href.indexOf(base) !== 0) throw new Error(baseElement.href);
          } catch (err) {
            throw new Error("URL unable to set base " + base + " due to " + err);
          }
        }
        var anchorElement = doc.createElement("a");
        anchorElement.href = url;
        if (baseElement) {
          doc.body.appendChild(anchorElement);
          anchorElement.href = anchorElement.href;
        }
        var inputElement = doc.createElement("input");
        inputElement.type = "url";
        inputElement.value = url;
        if (anchorElement.protocol === ":" || !/:/.test(anchorElement.href) || !inputElement.checkValidity() && !base) {
          throw new TypeError("Invalid URL");
        }
        Object.defineProperty(this, "_anchorElement", {
          value: anchorElement
        });
        var searchParams = new global2.URLSearchParams(this.search);
        var enableSearchUpdate = true;
        var enableSearchParamsUpdate = true;
        var _this = this;
        ["append", "delete", "set"].forEach(function(methodName) {
          var method = searchParams[methodName];
          searchParams[methodName] = function() {
            method.apply(searchParams, arguments);
            if (enableSearchUpdate) {
              enableSearchParamsUpdate = false;
              _this.search = searchParams.toString();
              enableSearchParamsUpdate = true;
            }
          };
        });
        Object.defineProperty(this, "searchParams", {
          value: searchParams,
          enumerable: true
        });
        var search = void 0;
        Object.defineProperty(this, "_updateSearchParams", {
          enumerable: false,
          configurable: false,
          writable: false,
          value: function() {
            if (this.search !== search) {
              search = this.search;
              if (enableSearchParamsUpdate) {
                enableSearchUpdate = false;
                this.searchParams._fromString(this.search);
                enableSearchUpdate = true;
              }
            }
          }
        });
      };
      var proto = URL2.prototype;
      var linkURLWithAnchorAttribute = function(attributeName) {
        Object.defineProperty(proto, attributeName, {
          get: function() {
            return this._anchorElement[attributeName];
          },
          set: function(value) {
            this._anchorElement[attributeName] = value;
          },
          enumerable: true
        });
      };
      ["hash", "host", "hostname", "port", "protocol"].forEach(function(attributeName) {
        linkURLWithAnchorAttribute(attributeName);
      });
      Object.defineProperty(proto, "search", {
        get: function() {
          return this._anchorElement["search"];
        },
        set: function(value) {
          this._anchorElement["search"] = value;
          this._updateSearchParams();
        },
        enumerable: true
      });
      Object.defineProperties(proto, {
        "toString": {
          get: function() {
            var _this = this;
            return function() {
              return _this.href;
            };
          }
        },
        "href": {
          get: function() {
            return this._anchorElement.href.replace(/\?$/, "");
          },
          set: function(value) {
            this._anchorElement.href = value;
            this._updateSearchParams();
          },
          enumerable: true
        },
        "pathname": {
          get: function() {
            return this._anchorElement.pathname.replace(/(^\/?)/, "/");
          },
          set: function(value) {
            this._anchorElement.pathname = value;
          },
          enumerable: true
        },
        "origin": {
          get: function() {
            var expectedPort = { "http:": 80, "https:": 443, "ftp:": 21 }[this._anchorElement.protocol];
            var addPortToOrigin = this._anchorElement.port != expectedPort && this._anchorElement.port !== "";
            return this._anchorElement.protocol + "//" + this._anchorElement.hostname + (addPortToOrigin ? ":" + this._anchorElement.port : "");
          },
          enumerable: true
        },
        "password": {
          // TODO
          get: function() {
            return "";
          },
          set: function(value) {
          },
          enumerable: true
        },
        "username": {
          // TODO
          get: function() {
            return "";
          },
          set: function(value) {
          },
          enumerable: true
        }
      });
      URL2.createObjectURL = function(blob) {
        return _URL.createObjectURL.apply(_URL, arguments);
      };
      URL2.revokeObjectURL = function(url) {
        return _URL.revokeObjectURL.apply(_URL, arguments);
      };
      global2.URL = URL2;
    };
    if (!checkIfURLIsSupported()) {
      polyfillURL();
    }
    if (global2.location !== void 0 && !("origin" in global2.location)) {
      var getOrigin = function() {
        return global2.location.protocol + "//" + global2.location.hostname + (global2.location.port ? ":" + global2.location.port : "");
      };
      try {
        Object.defineProperty(global2.location, "origin", {
          get: getOrigin,
          enumerable: true
        });
      } catch (e) {
        setInterval(function() {
          global2.location.origin = getOrigin();
        }, 100);
      }
    }
  })(
    typeof commonjsGlobal !== "undefined" ? commonjsGlobal : typeof window !== "undefined" ? window : typeof self !== "undefined" ? self : commonjsGlobal
  );
  if (typeof TextEncoder === "undefined" && typeof __host_utf8_encode !== "undefined") {
    class TextEncoderPolyfill {
      encode(s) {
        return __host_utf8_encode(s);
      }
    }
    globalThis.TextEncoder = TextEncoderPolyfill;
  }
  if (typeof TextDecoder === "undefined" && typeof __host_utf8_decode !== "undefined") {
    class TextDecoderPolyfill {
      constructor(label, options) {
        __publicField(this, "fatal");
        this.fatal = (options == null ? void 0 : options.fatal) ?? false;
      }
      decode(bytes) {
        const s = __host_utf8_decode(bytes);
        if (this.fatal) {
          const re = __host_utf8_encode(s);
          if (re.length !== bytes.length || !re.every((b, i) => b === bytes[i])) {
            throw new TypeError("The encoded data was not valid UTF-8");
          }
        }
        return s;
      }
    }
    globalThis.TextDecoder = TextDecoderPolyfill;
  }
  if (typeof structuredClone === "undefined") {
    const { clone } = require("structured-clone");
    globalThis.structuredClone = clone;
  }
  const rafQueue = /* @__PURE__ */ new Map();
  let nextRafId = 1;
  function requestAnimationFrameImpl(cb) {
    const id = nextRafId++;
    rafQueue.set(id, cb);
    return id;
  }
  function cancelAnimationFrameImpl(id) {
    rafQueue.delete(id);
  }
  function __tick() {
    const entries = Array.from(rafQueue.entries());
    rafQueue.clear();
    const now = performance.now();
    for (const [_, cb] of entries) {
      try {
        cb(now);
      } catch (e) {
        __host_log(e.stack ? String(e.stack) : String(e));
      }
    }
    runSweep();
    const bytes = writer.flush();
    if (bytes) __bridge_flush(bytes);
    return rafQueue.size > 0;
  }
  function __hasRaf() {
    return rafQueue.size > 0;
  }
  globalThis.requestAnimationFrame = requestAnimationFrameImpl;
  globalThis.cancelAnimationFrame = cancelAnimationFrameImpl;
  globalThis.__tick = __tick;
  globalThis.__hasRaf = __hasRaf;
  function __dispatchEvent(solidId, eventCode, payload) {
    dispatchEvent(solidId, eventCode, payload);
  }
  globalThis.__dispatchEvent = __dispatchEvent;
  const timers = /* @__PURE__ */ new Map();
  let nextTimerId = 1;
  function setTimeoutImpl(cb, delay, ...args) {
    const id = nextTimerId++;
    timers.set(id, { cb, args, repeat: false });
    __register_timer(id, delay || 0, false);
    return id;
  }
  function clearTimeoutImpl(id) {
    timers.delete(id);
    __unregister_timer(id);
  }
  function setIntervalImpl(cb, delay, ...args) {
    const id = nextTimerId++;
    timers.set(id, { cb, args, repeat: true });
    __register_timer(id, delay || 0, true);
    return id;
  }
  function __triggerTimer(id) {
    const entry = timers.get(id);
    if (!entry) return;
    try {
      entry.cb(...entry.args);
    } catch (e) {
      __host_log(e.stack ? String(e.stack) : String(e));
    }
    if (!entry.repeat) {
      timers.delete(id);
    }
  }
  globalThis.setTimeout = setTimeoutImpl;
  globalThis.clearTimeout = clearTimeoutImpl;
  globalThis.setInterval = setIntervalImpl;
  globalThis.clearInterval = clearTimeoutImpl;
  globalThis.__triggerTimer = __triggerTimer;
  const resizeObservers = /* @__PURE__ */ new Map();
  class ResizeObserver {
    constructor(callback) {
      __publicField(this, "callback");
      __publicField(this, "targets", /* @__PURE__ */ new Set());
      this.callback = callback;
    }
    observe(target) {
      const id = target.id;
      if (this.targets.has(id)) return;
      this.targets.add(id);
      let set = resizeObservers.get(id);
      if (!set) {
        set = /* @__PURE__ */ new Set();
        resizeObservers.set(id, set);
        __resize_observe(id);
      }
      set.add(this.callback);
    }
    unobserve(target) {
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
    disconnect() {
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
  globalThis.__resize_dispatch = (solidId, width, height) => {
    const set = resizeObservers.get(solidId);
    if (!set || set.size === 0) return;
    const entry = {
      target: { id: solidId },
      contentRect: { width, height }
    };
    for (const cb of set) {
      try {
        cb([entry]);
      } catch (e) {
        __host_log(`ResizeObserver callback error: ${(e == null ? void 0 : e.stack) ?? e}`);
      }
    }
  };
  globalThis.ResizeObserver = ResizeObserver;
  function createBeforeLeave() {
    let listeners = /* @__PURE__ */ new Set();
    function subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
    let ignore = false;
    function confirm(to, options) {
      if (ignore)
        return !(ignore = false);
      const e = {
        to,
        options,
        defaultPrevented: false,
        preventDefault: () => e.defaultPrevented = true
      };
      for (const l of listeners)
        l.listener({
          ...e,
          from: l.location,
          retry: (force) => {
            force && (ignore = true);
            l.navigate(to, { ...options, resolve: false });
          }
        });
      return !e.defaultPrevented;
    }
    return {
      subscribe,
      confirm
    };
  }
  function saveCurrentDepth() {
    if (!window.history.state || window.history.state._depth == null) {
      window.history.replaceState({ ...window.history.state, _depth: window.history.length - 1 }, "");
    }
    window.history.state._depth;
  }
  {
    saveCurrentDepth();
  }
  const hasSchemeRegex = /^(?:[a-z0-9]+:)?\/\//i;
  const trimPathRegex = /^\/+|(\/)\/+$/g;
  const mockBase = "http://sr";
  function normalizePath(path, omitSlash = false) {
    const s = path.replace(trimPathRegex, "$1");
    return s ? omitSlash || /^[?#]/.test(s) ? s : "/" + s : "";
  }
  function resolvePath(base, path, from) {
    if (hasSchemeRegex.test(path)) {
      return void 0;
    }
    const basePath = normalizePath(base);
    const fromPath = from && normalizePath(from);
    let result = "";
    if (!fromPath || path.startsWith("/")) {
      result = basePath;
    } else if (fromPath.toLowerCase().indexOf(basePath.toLowerCase()) !== 0) {
      result = basePath + fromPath;
    } else {
      result = fromPath;
    }
    return (result || "/") + normalizePath(path, !result);
  }
  function invariant(value, message) {
    if (value == null) {
      throw new Error(message);
    }
    return value;
  }
  function joinPaths(from, to) {
    return normalizePath(from).replace(/\/*(\*.*)?$/g, "") + normalizePath(to);
  }
  function extractSearchParams(url) {
    const params = {};
    url.searchParams.forEach((value, key) => {
      if (key in params) {
        if (Array.isArray(params[key]))
          params[key].push(value);
        else
          params[key] = [params[key], value];
      } else
        params[key] = value;
    });
    return params;
  }
  function createMatcher(path, partial, matchFilters) {
    const [pattern, splat] = path.split("/*", 2);
    const segments = pattern.split("/").filter(Boolean);
    const len = segments.length;
    return (location) => {
      const locSegments = location.split("/").filter(Boolean);
      const lenDiff = locSegments.length - len;
      if (lenDiff < 0 || lenDiff > 0 && splat === void 0 && !partial) {
        return null;
      }
      const match = {
        path: len ? "" : "/",
        params: {}
      };
      const matchFilter = (s) => matchFilters === void 0 ? void 0 : matchFilters[s];
      for (let i = 0; i < len; i++) {
        const segment = segments[i];
        const dynamic = segment[0] === ":";
        const locSegment = dynamic ? locSegments[i] : locSegments[i].toLowerCase();
        const key = dynamic ? segment.slice(1) : segment.toLowerCase();
        if (dynamic && matchSegment(locSegment, matchFilter(key))) {
          match.params[key] = locSegment;
        } else if (dynamic || !matchSegment(locSegment, key)) {
          return null;
        }
        match.path += `/${locSegment}`;
      }
      if (splat) {
        const remainder = lenDiff ? locSegments.slice(-lenDiff).join("/") : "";
        if (matchSegment(remainder, matchFilter(splat))) {
          match.params[splat] = remainder;
        } else {
          return null;
        }
      }
      return match;
    };
  }
  function matchSegment(input, filter) {
    const isEqual = (s) => s === input;
    if (filter === void 0) {
      return true;
    } else if (typeof filter === "string") {
      return isEqual(filter);
    } else if (typeof filter === "function") {
      return filter(input);
    } else if (Array.isArray(filter)) {
      return filter.some(isEqual);
    } else if (filter instanceof RegExp) {
      return filter.test(input);
    }
    return false;
  }
  function scoreRoute(route) {
    const [pattern, splat] = route.pattern.split("/*", 2);
    const segments = pattern.split("/").filter(Boolean);
    return segments.reduce((score, segment) => score + (segment.startsWith(":") ? 2 : 3), segments.length - (splat === void 0 ? 0 : 1));
  }
  function createMemoObject(fn) {
    const map = /* @__PURE__ */ new Map();
    const owner = getOwner();
    return new Proxy({}, {
      get(_, property) {
        if (!map.has(property)) {
          runWithOwner(owner, () => map.set(property, createMemo(() => fn()[property])));
        }
        return map.get(property)();
      },
      getOwnPropertyDescriptor() {
        return {
          enumerable: true,
          configurable: true
        };
      },
      ownKeys() {
        return Reflect.ownKeys(fn());
      },
      has(_, property) {
        return property in fn();
      }
    });
  }
  function expandOptionals(pattern) {
    let match = /(\/?\:[^\/]+)\?/.exec(pattern);
    if (!match)
      return [pattern];
    let prefix = pattern.slice(0, match.index);
    let suffix = pattern.slice(match.index + match[0].length);
    const prefixes = [prefix, prefix += match[1]];
    while (match = /^(\/\:[^\/]+)\?/.exec(suffix)) {
      prefixes.push(prefix += match[1]);
      suffix = suffix.slice(match[0].length);
    }
    return expandOptionals(suffix).reduce((results, expansion) => [...results, ...prefixes.map((p) => p + expansion)], []);
  }
  const MAX_REDIRECTS = 100;
  const RouterContextObj = createContext();
  const RouteContextObj = createContext();
  const useRouter = () => invariant(useContext(RouterContextObj), "<A> and 'use' router primitives can be only used inside a Route.");
  const useNavigate = () => useRouter().navigatorFactory();
  const useLocation = () => useRouter().location;
  const useParams = () => useRouter().params;
  function createRoutes(routeDef, base = "") {
    const { component, preload, load, children: children2, info } = routeDef;
    const isLeaf = !children2 || Array.isArray(children2) && !children2.length;
    const shared = {
      key: routeDef,
      component,
      preload: preload || load,
      info
    };
    return asArray(routeDef.path).reduce((acc, originalPath) => {
      for (const expandedPath of expandOptionals(originalPath)) {
        const path = joinPaths(base, expandedPath);
        let pattern = isLeaf ? path : path.split("/*", 1)[0];
        pattern = pattern.split("/").map((s) => {
          return s.startsWith(":") || s.startsWith("*") ? s : encodeURIComponent(s);
        }).join("/");
        acc.push({
          ...shared,
          originalPath,
          pattern,
          matcher: createMatcher(pattern, !isLeaf, routeDef.matchFilters)
        });
      }
      return acc;
    }, []);
  }
  function createBranch(routes, index = 0) {
    return {
      routes,
      score: scoreRoute(routes[routes.length - 1]) * 1e4 - index,
      matcher(location) {
        const matches = [];
        for (let i = routes.length - 1; i >= 0; i--) {
          const route = routes[i];
          const match = route.matcher(location);
          if (!match) {
            return null;
          }
          matches.unshift({
            ...match,
            route
          });
        }
        return matches;
      }
    };
  }
  function asArray(value) {
    return Array.isArray(value) ? value : [value];
  }
  function createBranches(routeDef, base = "", stack = [], branches = []) {
    const routeDefs = asArray(routeDef);
    for (let i = 0, len = routeDefs.length; i < len; i++) {
      const def = routeDefs[i];
      if (def && typeof def === "object") {
        if (!def.hasOwnProperty("path"))
          def.path = "";
        const routes = createRoutes(def, base);
        for (const route of routes) {
          stack.push(route);
          const isEmptyArray = Array.isArray(def.children) && def.children.length === 0;
          if (def.children && !isEmptyArray) {
            createBranches(def.children, route.pattern, stack, branches);
          } else {
            const branch = createBranch([...stack], branches.length);
            branches.push(branch);
          }
          stack.pop();
        }
      }
    }
    return stack.length ? branches : branches.sort((a, b) => b.score - a.score);
  }
  function getRouteMatches(branches, location) {
    for (let i = 0, len = branches.length; i < len; i++) {
      const match = branches[i].matcher(location);
      if (match) {
        return match;
      }
    }
    return [];
  }
  function createLocation(path, state, queryWrapper) {
    const origin = new URL(mockBase);
    const url = createMemo((prev) => {
      const path_ = path();
      try {
        return new URL(path_, origin);
      } catch (err) {
        console.error(`Invalid path ${path_}`);
        return prev;
      }
    }, origin, {
      equals: (a, b) => a.href === b.href
    });
    const pathname = createMemo(() => url().pathname);
    const search = createMemo(() => url().search, true);
    const hash = createMemo(() => url().hash);
    const key = () => "";
    const queryFn = on(search, () => extractSearchParams(url()));
    return {
      get pathname() {
        return pathname();
      },
      get search() {
        return search();
      },
      get hash() {
        return hash();
      },
      get state() {
        return state();
      },
      get key() {
        return key();
      },
      query: queryWrapper ? queryWrapper(queryFn) : createMemoObject(queryFn)
    };
  }
  let intent;
  function getIntent() {
    return intent;
  }
  function setInPreloadFn(value) {
  }
  function createRouterContext(integration, branches, getContext, options = {}) {
    const { signal: [source, setSource], utils = {} } = integration;
    const parsePath = utils.parsePath || ((p) => p);
    const renderPath = utils.renderPath || ((p) => p);
    const beforeLeave = utils.beforeLeave || createBeforeLeave();
    const basePath = resolvePath("", options.base || "");
    if (basePath === void 0) {
      throw new Error(`${basePath} is not a valid base path`);
    } else if (basePath && !source().value) {
      setSource({ value: basePath, replace: true, scroll: false });
    }
    const [isRouting, setIsRouting] = createSignal(false);
    let lastTransitionTarget;
    const transition = (newIntent, newTarget) => {
      if (newTarget.value === reference() && newTarget.state === state())
        return;
      if (lastTransitionTarget === void 0)
        setIsRouting(true);
      intent = newIntent;
      lastTransitionTarget = newTarget;
      startTransition(() => {
        if (lastTransitionTarget !== newTarget)
          return;
        setReference(lastTransitionTarget.value);
        setState(lastTransitionTarget.state);
        submissions[1]((subs) => subs.filter((s) => s.pending));
      }).finally(() => {
        if (lastTransitionTarget !== newTarget)
          return;
        batch(() => {
          intent = void 0;
          if (newIntent === "navigate")
            navigateEnd(lastTransitionTarget);
          setIsRouting(false);
          lastTransitionTarget = void 0;
        });
      });
    };
    const [reference, setReference] = createSignal(source().value);
    const [state, setState] = createSignal(source().state);
    const location = createLocation(reference, state, utils.queryWrapper);
    const referrers = [];
    const submissions = createSignal([]);
    const matches = createMemo(() => {
      if (typeof options.transformUrl === "function") {
        return getRouteMatches(branches(), options.transformUrl(location.pathname));
      }
      return getRouteMatches(branches(), location.pathname);
    });
    const buildParams = () => {
      const m = matches();
      const params2 = {};
      for (let i = 0; i < m.length; i++) {
        Object.assign(params2, m[i].params);
      }
      return params2;
    };
    const params = utils.paramsWrapper ? utils.paramsWrapper(buildParams, branches) : createMemoObject(buildParams);
    const baseRoute = {
      pattern: basePath,
      path: () => basePath,
      outlet: () => null,
      resolvePath(to) {
        return resolvePath(basePath, to);
      }
    };
    createRenderEffect(on(source, (source2) => transition("native", source2), { defer: true }));
    return {
      base: baseRoute,
      location,
      params,
      isRouting,
      renderPath,
      parsePath,
      navigatorFactory,
      matches,
      beforeLeave,
      preloadRoute,
      singleFlight: options.singleFlight === void 0 ? true : options.singleFlight,
      submissions
    };
    function navigateFromRoute(route, to, options2) {
      untrack(() => {
        if (typeof to === "number") {
          if (!to) {
          } else if (utils.go) {
            utils.go(to);
          } else {
            console.warn("Router integration does not support relative routing");
          }
          return;
        }
        const queryOnly = !to || to[0] === "?";
        const { replace, resolve, scroll, state: nextState } = {
          replace: false,
          resolve: !queryOnly,
          scroll: true,
          ...options2
        };
        const resolvedTo = resolve ? route.resolvePath(to) : resolvePath(queryOnly && location.pathname || "", to);
        if (resolvedTo === void 0) {
          throw new Error(`Path '${to}' is not a routable path`);
        } else if (referrers.length >= MAX_REDIRECTS) {
          throw new Error("Too many redirects");
        }
        const current = reference();
        if (resolvedTo !== current || nextState !== state()) {
          if (isServer) ;
          else if (beforeLeave.confirm(resolvedTo, options2)) {
            referrers.push({ value: current, replace, scroll, state: state() });
            transition("navigate", {
              value: resolvedTo,
              state: nextState
            });
          }
        }
      });
    }
    function navigatorFactory(route) {
      route = route || useContext(RouteContextObj) || baseRoute;
      return (to, options2) => navigateFromRoute(route, to, options2);
    }
    function navigateEnd(next) {
      const first = referrers[0];
      if (first) {
        setSource({
          ...next,
          replace: first.replace,
          scroll: first.scroll
        });
        referrers.length = 0;
      }
    }
    function preloadRoute(url, preloadData) {
      const matches2 = getRouteMatches(branches(), url.pathname);
      const prevIntent = intent;
      intent = "preload";
      for (let match in matches2) {
        const { route, params: params2 } = matches2[match];
        route.component && route.component.preload && route.component.preload();
        const { preload } = route;
        preloadData && preload && runWithOwner(getContext(), () => preload({
          params: params2,
          location: {
            pathname: url.pathname,
            search: url.search,
            hash: url.hash,
            query: extractSearchParams(url),
            state: null,
            key: ""
          },
          intent: "preload"
        }));
      }
      intent = prevIntent;
    }
  }
  function createRouteContext(router, parent, outlet, match) {
    const { base, location, params } = router;
    const { pattern, component, preload } = match().route;
    const path = createMemo(() => match().path);
    component && component.preload && component.preload();
    const data = preload ? preload({ params, location, intent: intent || "initial" }) : void 0;
    const route = {
      parent,
      pattern,
      path,
      outlet: () => component ? createComponent$1(component, {
        params,
        location,
        data,
        get children() {
          return outlet();
        }
      }) : outlet(),
      resolvePath(to) {
        return resolvePath(base.path(), to, path());
      }
    };
    return route;
  }
  const createRouterComponent = (router) => (props) => {
    const {
      base
    } = props;
    const routeDefs = children(() => props.children);
    const branches = createMemo(() => createBranches(routeDefs(), props.base || ""));
    let context;
    const routerState = createRouterContext(router, branches, () => context, {
      base,
      singleFlight: props.singleFlight,
      transformUrl: props.transformUrl
    });
    router.create && router.create(routerState);
    return createComponent(RouterContextObj.Provider, {
      value: routerState,
      get children() {
        return createComponent(Root, {
          routerState,
          get root() {
            return props.root;
          },
          get preload() {
            return props.rootPreload || props.rootLoad;
          },
          get children() {
            return [memo(() => (context = getOwner()) && null), createComponent(Routes, {
              routerState,
              get branches() {
                return branches();
              }
            })];
          }
        });
      }
    });
  };
  function Root(props) {
    const location = props.routerState.location;
    const params = props.routerState.params;
    const data = createMemo(() => props.preload && untrack(() => {
      setInPreloadFn(true);
      props.preload({
        params,
        location,
        intent: getIntent() || "initial"
      });
      setInPreloadFn(false);
    }));
    return createComponent(Show, {
      get when() {
        return props.root;
      },
      keyed: true,
      get fallback() {
        return props.children;
      },
      children: (Root2) => createComponent(Root2, {
        params,
        location,
        get data() {
          return data();
        },
        get children() {
          return props.children;
        }
      })
    });
  }
  function Routes(props) {
    const disposers = [];
    let root;
    const routeStates = createMemo(on(props.routerState.matches, (nextMatches, prevMatches, prev) => {
      let equal = prevMatches && nextMatches.length === prevMatches.length;
      const next = [];
      for (let i = 0, len = nextMatches.length; i < len; i++) {
        const prevMatch = prevMatches && prevMatches[i];
        const nextMatch = nextMatches[i];
        if (prev && prevMatch && nextMatch.route.key === prevMatch.route.key) {
          next[i] = prev[i];
        } else {
          equal = false;
          if (disposers[i]) {
            disposers[i]();
          }
          createRoot((dispose2) => {
            disposers[i] = dispose2;
            next[i] = createRouteContext(props.routerState, next[i - 1] || props.routerState.base, createOutlet(() => routeStates()[i + 1]), () => {
              const routeMatches = props.routerState.matches();
              return routeMatches[i] ?? routeMatches[0];
            });
          });
        }
      }
      disposers.splice(nextMatches.length).forEach((dispose2) => dispose2());
      if (prev && equal) {
        return prev;
      }
      root = next[0];
      return next;
    }));
    return createOutlet(() => routeStates() && root)();
  }
  const createOutlet = (child) => {
    return () => createComponent(Show, {
      get when() {
        return child();
      },
      keyed: true,
      children: (child2) => createComponent(RouteContextObj.Provider, {
        value: child2,
        get children() {
          return child2.outlet();
        }
      })
    });
  };
  const Route = (props) => {
    const childRoutes = children(() => props.children);
    return mergeProps$1(props, {
      get children() {
        return childRoutes();
      }
    });
  };
  function intercept([value, setValue], get, set) {
    return [value, set ? (v) => setValue(set(v)) : setValue];
  }
  function createRouter(config) {
    let ignore = false;
    const wrap = (value) => typeof value === "string" ? { value } : value;
    const signal = intercept(createSignal(wrap(config.get()), {
      equals: (a, b) => a.value === b.value && a.state === b.state
    }), void 0, (next) => {
      !ignore && config.set(next);
      return next;
    });
    config.init && onCleanup(config.init((value = config.get()) => {
      ignore = true;
      signal[1](wrap(value));
      ignore = false;
    }));
    return createRouterComponent({
      signal,
      create: config.create,
      utils: config.utils
    });
  }
  function scrollToHash(hash, fallbackTop) {
    const el = hash && document.getElementById(hash);
    if (el) {
      el.scrollIntoView();
    } else {
      window.scrollTo(0, 0);
    }
  }
  const actions = /* @__PURE__ */ new Map();
  function setupNativeEvents({ preload = true, explicitLinks = false, actionBase = "/_server", transformUrl } = {}) {
    return (router) => {
      const basePath = router.base.path();
      const navigateFromRoute = router.navigatorFactory(router.base);
      let preloadTimeout;
      let lastElement;
      function isSvg(el) {
        return el.namespaceURI === "http://www.w3.org/2000/svg";
      }
      function handleAnchor(evt) {
        if (evt.defaultPrevented || evt.button !== 0 || evt.metaKey || evt.altKey || evt.ctrlKey || evt.shiftKey)
          return;
        const a = evt.composedPath().find((el) => el instanceof Node && el.nodeName.toUpperCase() === "A");
        if (!a || explicitLinks && !a.hasAttribute("link"))
          return;
        const svg = isSvg(a);
        const href = svg ? a.href.baseVal : a.href;
        const target = svg ? a.target.baseVal : a.target;
        if (target || !href && !a.hasAttribute("state"))
          return;
        const rel = (a.getAttribute("rel") || "").split(/\s+/);
        if (a.hasAttribute("download") || rel && rel.includes("external"))
          return;
        const url = svg ? new URL(href, document.baseURI) : new URL(href);
        if (url.origin !== window.location.origin || basePath && url.pathname && !url.pathname.toLowerCase().startsWith(basePath.toLowerCase()))
          return;
        return [a, url];
      }
      function handleAnchorClick(evt) {
        const res = handleAnchor(evt);
        if (!res)
          return;
        const [a, url] = res;
        const to = router.parsePath(url.pathname + url.search + url.hash);
        const state = a.getAttribute("state");
        evt.preventDefault();
        navigateFromRoute(to, {
          resolve: false,
          replace: a.hasAttribute("replace"),
          scroll: !a.hasAttribute("noscroll"),
          state: state ? JSON.parse(state) : void 0
        });
      }
      function handleAnchorPreload(evt) {
        const res = handleAnchor(evt);
        if (!res)
          return;
        const [a, url] = res;
        transformUrl && (url.pathname = transformUrl(url.pathname));
        router.preloadRoute(url, a.getAttribute("preload") !== "false");
      }
      function handleAnchorMove(evt) {
        clearTimeout(preloadTimeout);
        const res = handleAnchor(evt);
        if (!res)
          return lastElement = null;
        const [a, url] = res;
        if (lastElement === a)
          return;
        transformUrl && (url.pathname = transformUrl(url.pathname));
        preloadTimeout = setTimeout(() => {
          router.preloadRoute(url, a.getAttribute("preload") !== "false");
          lastElement = a;
        }, 20);
      }
      function handleFormSubmit(evt) {
        if (evt.defaultPrevented)
          return;
        let actionRef = evt.submitter && evt.submitter.hasAttribute("formaction") ? evt.submitter.getAttribute("formaction") : evt.target.getAttribute("action");
        if (!actionRef)
          return;
        if (!actionRef.startsWith("https://action/")) {
          const url = new URL(actionRef, mockBase);
          actionRef = router.parsePath(url.pathname + url.search);
          if (!actionRef.startsWith(actionBase))
            return;
        }
        if (evt.target.method.toUpperCase() !== "POST")
          throw new Error("Only POST forms are supported for Actions");
        const handler = actions.get(actionRef);
        if (handler) {
          evt.preventDefault();
          const data = new FormData(evt.target, evt.submitter);
          handler.call({ r: router, f: evt.target }, evt.target.enctype === "multipart/form-data" ? data : new URLSearchParams(data));
        }
      }
      document.addEventListener("click", handleAnchorClick);
      if (preload) {
        document.addEventListener("mousemove", handleAnchorMove, { passive: true });
        document.addEventListener("focusin", handleAnchorPreload, { passive: true });
        document.addEventListener("touchstart", handleAnchorPreload, { passive: true });
      }
      document.addEventListener("submit", handleFormSubmit);
      onCleanup(() => {
        document.removeEventListener("click", handleAnchorClick);
        if (preload) {
          document.removeEventListener("mousemove", handleAnchorMove);
          document.removeEventListener("focusin", handleAnchorPreload);
          document.removeEventListener("touchstart", handleAnchorPreload);
        }
        document.removeEventListener("submit", handleFormSubmit);
      });
    };
  }
  function createMemoryHistory() {
    const entries = ["/"];
    let index = 0;
    const listeners = [];
    const go = (n) => {
      index = Math.max(0, Math.min(index + n, entries.length - 1));
      const value = entries[index];
      listeners.forEach((listener) => listener(value));
    };
    return {
      get: () => entries[index],
      set: ({ value, scroll, replace }) => {
        if (replace) {
          entries[index] = value;
        } else {
          entries.splice(index + 1, entries.length - index, value);
          index++;
        }
        listeners.forEach((listener) => listener(value));
        setTimeout(() => {
          if (scroll) {
            scrollToHash(value.split("#")[1] || "");
          }
        }, 0);
      },
      back: () => {
        go(-1);
      },
      forward: () => {
        go(1);
      },
      go,
      listen: (listener) => {
        listeners.push(listener);
        return () => {
          const index2 = listeners.indexOf(listener);
          listeners.splice(index2, 1);
        };
      }
    };
  }
  function MemoryRouter(props) {
    const memoryHistory = props.history || createMemoryHistory();
    return createRouter({
      get: memoryHistory.get,
      set: memoryHistory.set,
      init: memoryHistory.listen,
      create: setupNativeEvents({ preload: props.preload, explicitLinks: props.explicitLinks, actionBase: props.actionBase }),
      utils: {
        go: memoryHistory.go
      }
    })(props);
  }
  /**
  * @license lucide-solid v1.24.0 - ISC
  *
  * This source code is licensed under the ISC license.
  * See the LICENSE file in the root directory of this source tree.
  */
  var defaultAttributes = {
    xmlns: "http://www.w3.org/2000/svg",
    width: 24,
    height: 24,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": 2,
    "stroke-linecap": "round",
    "stroke-linejoin": "round"
  };
  var defaultAttributes_default = defaultAttributes;
  var LucideContext = createContext({
    size: 24,
    color: "currentColor",
    strokeWidth: 2,
    absoluteStrokeWidth: false,
    class: ""
  });
  var hasA11yProp = (props) => {
    for (const prop in props) {
      if (prop.startsWith("aria-") || prop === "role" || prop === "title") {
        return true;
      }
    }
    return false;
  };
  var mergeClasses = (...classes) => classes.filter((className, index, array) => {
    return Boolean(className) && className.trim() !== "" && array.indexOf(className) === index;
  }).join(" ").trim();
  var toCamelCase = (string) => string.replace(/^([A-Z])|[\s-_]+(\w)/g, (match, p1, p2) => p2 ? p2.toUpperCase() : p1.toLowerCase());
  var toKebabCase = (string) => string.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
  var toPascalCase = (string) => {
    const camelCase = toCamelCase(string);
    return camelCase.charAt(0).toUpperCase() + camelCase.slice(1);
  };
  var Icon = (props) => {
    const [localProps, rest] = splitProps(props, ["color", "size", "strokeWidth", "children", "class", "name", "iconNode", "absoluteStrokeWidth"]);
    const globalProps = useContext(LucideContext);
    return (() => {
      var _el$ = createElement("svg");
      spread(_el$, mergeProps(defaultAttributes_default, {
        get width() {
          return localProps.size ?? globalProps.size ?? defaultAttributes_default.width;
        },
        get height() {
          return localProps.size ?? globalProps.size ?? defaultAttributes_default.height;
        },
        get stroke() {
          return localProps.color ?? globalProps.color ?? defaultAttributes_default.stroke;
        },
        get ["stroke-width"]() {
          return memo(() => (localProps.absoluteStrokeWidth ?? globalProps.absoluteStrokeWidth) === true)() ? Number(localProps.strokeWidth ?? globalProps.strokeWidth ?? defaultAttributes_default["stroke-width"]) * 24 / Number(localProps.size ?? globalProps.size) : Number(localProps.strokeWidth ?? globalProps.strokeWidth ?? defaultAttributes_default["stroke-width"]);
        },
        get ["class"]() {
          return mergeClasses("lucide", "lucide-icon", globalProps.class, ...localProps.name != null ? [`lucide-${toKebabCase(toPascalCase(localProps.name))}`, `lucide-${toKebabCase(localProps.name)}`] : [], localProps.class);
        },
        get ["aria-hidden"]() {
          return !localProps.children && !hasA11yProp(rest) ? "true" : void 0;
        }
      }, rest), true);
      insert(_el$, createComponent(For, {
        get each() {
          return localProps.iconNode;
        },
        children: ([elementName, attrs]) => {
          return createComponent(Dynamic, mergeProps({
            component: elementName
          }, attrs));
        }
      }));
      return _el$;
    })();
  };
  var Icon_default = Icon;
  var iconNode$4 = [["path", {
    d: "M15 18h-5",
    key: "95g1m2"
  }], ["path", {
    d: "M18 14h-8",
    key: "sponae"
  }], ["path", {
    d: "M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-4 0v-9a2 2 0 0 1 2-2h2",
    key: "39pd36"
  }], ["rect", {
    width: "8",
    height: "4",
    x: "10",
    y: "6",
    rx: "1",
    key: "aywv1n"
  }]];
  var Newspaper = (props) => createComponent(Icon_default, mergeProps(props, {
    iconNode: iconNode$4,
    name: "newspaper"
  }));
  var newspaper_default = Newspaper;
  var iconNode$3 = [["path", {
    d: "M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8",
    key: "v9h5vc"
  }], ["path", {
    d: "M21 3v5h-5",
    key: "1q7to0"
  }], ["path", {
    d: "M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16",
    key: "3uifl3"
  }], ["path", {
    d: "M8 16H3v5",
    key: "1cv678"
  }]];
  var RefreshCw = (props) => createComponent(Icon_default, mergeProps(props, {
    iconNode: iconNode$3,
    name: "refresh-cw"
  }));
  var refresh_cw_default = RefreshCw;
  const storiesSignal = createSignal([]);
  const loadingSignal = createSignal(true);
  const loadErrorSignal = createSignal(null);
  const querySignal = createSignal("");
  const stories = storiesSignal[0];
  const setStories = storiesSignal[1];
  const loading = loadingSignal[0];
  const setLoading = loadingSignal[1];
  const loadError = loadErrorSignal[0];
  const setLoadError = loadErrorSignal[1];
  const query = querySignal[0];
  const setQuery = querySignal[1];
  async function loadStories() {
    setLoading(true);
    setLoadError(null);
    try {
      const result = JSON.parse(await fetchTopStories());
      setStories(result.filter((story) => (story == null ? void 0 : story.id) && (story == null ? void 0 : story.title)));
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }
  function storyHost(url) {
    if (!url) return "news.ycombinator.com";
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return "external link";
    }
  }
  function relativeTime(timestamp) {
    if (!timestamp) return "recently";
    const minutes = Math.max(1, Math.floor((Date.now() / 1e3 - timestamp) / 60));
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  }
  function AppShell(props) {
    const location = useLocation();
    const navigate = useNavigate();
    const isFeed = () => location.pathname === "/";
    onMount(() => {
      if (stories().length === 0) void loadStories();
    });
    return (() => {
      var _el$ = createElement("div"), _el$2 = createElement("aside"), _el$3 = createElement("button"), _el$4 = createElement("span"), _el$6 = createElement("span"), _el$8 = createElement("nav"), _el$9 = createElement("button"), _el$0 = createElement("span"), _el$10 = createElement("span"), _el$11 = createElement("div"), _el$12 = createElement("button"), _el$13 = createElement("span"), _el$14 = createElement("div"), _el$15 = createElement("span"), _el$16 = createTextNode(`Rust data bridge`), _el$17 = createElement("main");
      insertNode(_el$, _el$2);
      insertNode(_el$, _el$17);
      setProp(_el$, "class", "w-full h-screen overflow-hidden flex bg-[#eef0f2] text-[#20272e] font-sans select-none");
      insertNode(_el$2, _el$3);
      insertNode(_el$2, _el$8);
      insertNode(_el$2, _el$11);
      setProp(_el$2, "class", "w-48 flex-none flex flex-col bg-[#20262d] text-[#d8dde2] border-r border-[#151a1f]");
      insertNode(_el$3, _el$4);
      insertNode(_el$3, _el$6);
      setProp(_el$3, "class", "h-16 px-5 flex items-center gap-3 border-0 border-b border-[#303840] bg-transparent text-white text-left cursor-pointer");
      setProp(_el$3, "type", "button");
      setProp(_el$3, "onClick", () => navigate("/"));
      insertNode(_el$4, createTextNode(`Y`));
      setProp(_el$4, "class", "w-7 h-7 flex items-center justify-center bg-[#f26522] text-white font-serif text-base");
      insertNode(_el$6, createTextNode(`Hacker News`));
      setProp(_el$6, "class", "text-sm font-700");
      insertNode(_el$8, _el$9);
      setProp(_el$8, "class", "flex-1 p-2.5");
      setProp(_el$8, "aria-label", "Stories");
      insertNode(_el$9, _el$0);
      insertNode(_el$9, _el$10);
      setProp(_el$9, "type", "button");
      setProp(_el$9, "onClick", () => navigate("/"));
      insert(_el$9, createComponent(newspaper_default, {
        size: 16
      }), _el$0);
      insertNode(_el$0, createTextNode(`Top stories`));
      setProp(_el$10, "class", "ml-auto text-11px text-[#77838e]");
      insert(_el$10, () => stories().length || "");
      insertNode(_el$11, _el$12);
      insertNode(_el$11, _el$14);
      setProp(_el$11, "class", "p-3 border-t border-[#303840]");
      insertNode(_el$12, _el$13);
      setProp(_el$12, "class", "w-full h-9 px-3 flex items-center gap-3 border-0 rounded bg-transparent text-[#9da8b2] text-xs text-left cursor-pointer disabled:opacity-55");
      setProp(_el$12, "type", "button");
      setProp(_el$12, "onClick", () => void loadStories());
      insert(_el$12, createComponent(refresh_cw_default, {
        size: 14,
        get ["class"]() {
          return loading() ? "opacity-55" : "";
        }
      }), _el$13);
      insert(_el$13, () => loading() ? "Updating..." : "Refresh");
      insertNode(_el$14, _el$15);
      insertNode(_el$14, _el$16);
      setProp(_el$14, "class", "mt-2 px-3 flex items-center gap-2 text-10px text-[#6f7b85]");
      setProp(_el$15, "class", "w-1.5 h-1.5 rounded-full bg-[#4eb47c]");
      setProp(_el$17, "class", "flex-1 min-w-0 min-h-0 overflow-hidden bg-white");
      insert(_el$17, () => props.children);
      effect((_p$) => {
        var _v$ = `w-full h-10 px-3 flex items-center gap-3 border-0 rounded text-left text-13px cursor-pointer ${isFeed() ? "bg-[#343c45] text-white" : "bg-transparent text-[#9da8b2]"}`, _v$2 = loading();
        _v$ !== _p$.e && (_p$.e = setProp(_el$9, "class", _v$, _p$.e));
        _v$2 !== _p$.t && (_p$.t = setProp(_el$12, "disabled", _v$2, _p$.t));
        return _p$;
      }, {
        e: void 0,
        t: void 0
      });
      return _el$;
    })();
  }
  var iconNode$2 = [["path", {
    d: "m12 19-7-7 7-7",
    key: "1l729n"
  }], ["path", {
    d: "M19 12H5",
    key: "x3x0zl"
  }]];
  var ArrowLeft = (props) => createComponent(Icon_default, mergeProps(props, {
    iconNode: iconNode$2,
    name: "arrow-left"
  }));
  var arrow_left_default = ArrowLeft;
  var iconNode$1 = [["path", {
    d: "M15 3h6v6",
    key: "1q9fwt"
  }], ["path", {
    d: "M10 14 21 3",
    key: "gplh6r"
  }], ["path", {
    d: "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6",
    key: "a6xqqp"
  }]];
  var ExternalLink = (props) => createComponent(Icon_default, mergeProps(props, {
    iconNode: iconNode$1,
    name: "external-link"
  }));
  var external_link_default = ExternalLink;
  function StoryDetail() {
    const params = useParams();
    const navigate = useNavigate();
    const story = createMemo(() => stories().find((item) => item.id === Number(params.id)));
    return (() => {
      var _el$ = createElement("section"), _el$2 = createElement("div"), _el$3 = createElement("button"), _el$4 = createTextNode(`Stories`), _el$5 = createElement("span");
      insertNode(_el$, _el$2);
      setProp(_el$, "class", "h-full min-h-0 flex flex-col bg-white overflow-hidden");
      insertNode(_el$2, _el$3);
      insertNode(_el$2, _el$5);
      setProp(_el$2, "class", "h-13 flex-none px-4 flex items-center border-b border-[#dfe3e6] bg-[#f8f9fa]");
      insertNode(_el$3, _el$4);
      setProp(_el$3, "class", "h-8 px-2.5 flex items-center gap-2 border border-[#ccd2d7] rounded bg-white text-[#56616b] text-xs cursor-pointer");
      setProp(_el$3, "type", "button");
      setProp(_el$3, "onClick", () => navigate(-1));
      insert(_el$3, createComponent(arrow_left_default, {
        size: 14
      }), _el$4);
      insertNode(_el$5, createTextNode(`Story details`));
      setProp(_el$5, "class", "ml-4 text-xs text-[#929ba3]");
      insert(_el$, createComponent(Show, {
        get when() {
          return story();
        },
        get fallback() {
          return createComponent(MissingStory, {});
        },
        children: (current) => (() => {
          var _el$7 = createElement("article"), _el$8 = createElement("p"), _el$9 = createElement("h1"), _el$0 = createElement("div"), _el$1 = createElement("span"), _el$10 = createElement("strong"), _el$11 = createTextNode(` points`), _el$12 = createElement("span"), _el$13 = createTextNode(`submitted by `), _el$15 = createElement("strong"), _el$16 = createElement("span"), _el$17 = createElement("div"), _el$20 = createElement("a"), _el$21 = createTextNode(` comments on Hacker News`), _el$22 = createElement("div"), _el$23 = createElement("span"), _el$24 = createTextNode(`Story data fetched asynchronously by Rust and rendered in Solid`);
          insertNode(_el$7, _el$8);
          insertNode(_el$7, _el$9);
          insertNode(_el$7, _el$0);
          insertNode(_el$7, _el$17);
          insertNode(_el$7, _el$22);
          setProp(_el$7, "class", "flex-1 min-h-0 overflow-y-auto px-8 py-7");
          setProp(_el$8, "class", "m-0 mb-1 text-[#d95316] text-11px font-700 uppercase");
          insert(_el$8, () => storyHost(current().url));
          setProp(_el$9, "class", "m-0 max-w-175 text-[#20272e] text-2xl font-650 leading-tight");
          insert(_el$9, () => current().title);
          insertNode(_el$0, _el$1);
          insertNode(_el$0, _el$12);
          insertNode(_el$0, _el$16);
          setProp(_el$0, "class", "mt-4.5 flex lt-md:flex-col lt-md:items-start gap-4.5 text-[#7c8790] text-xs");
          insertNode(_el$1, _el$10);
          insertNode(_el$1, _el$11);
          setProp(_el$10, "class", "text-[#45515c]");
          insert(_el$10, () => current().score);
          insertNode(_el$12, _el$13);
          insertNode(_el$12, _el$15);
          setProp(_el$15, "class", "text-[#45515c]");
          insert(_el$15, () => current().by);
          insert(_el$16, () => relativeTime(current().time));
          insertNode(_el$17, _el$20);
          setProp(_el$17, "class", "mt-8.5 flex lt-md:flex-col lt-md:items-start gap-2.5");
          insert(_el$17, createComponent(Show, {
            get when() {
              return current().url;
            },
            get children() {
              var _el$18 = createElement("a"), _el$19 = createTextNode(`Read original article `);
              insertNode(_el$18, _el$19);
              setProp(_el$18, "class", "px-3.5 py-2.5 flex items-center gap-2 rounded bg-[#e85b1a] text-white text-xs font-600 no-underline");
              insert(_el$18, createComponent(external_link_default, {
                size: 13
              }), null);
              effect((_$p) => setProp(_el$18, "href", current().url, _$p));
              return _el$18;
            }
          }), _el$20);
          insertNode(_el$20, _el$21);
          setProp(_el$20, "class", "px-3.5 py-2.5 border border-[#ccd2d7] rounded bg-white text-[#46535e] text-xs font-600 no-underline");
          insert(_el$20, () => current().descendants ?? 0, _el$21);
          insertNode(_el$22, _el$23);
          insertNode(_el$22, _el$24);
          setProp(_el$22, "class", "max-w-175 mt-10 pt-4 flex items-center gap-2 border-t border-[#e7eaec] text-[#8a949d] text-11px");
          setProp(_el$23, "class", "w-1.75 h-1.75 rounded-full bg-[#37a66b]");
          effect((_$p) => setProp(_el$20, "href", `https://news.ycombinator.com/item?id=${current().id}`, _$p));
          return _el$7;
        })()
      }), null);
      return _el$;
    })();
  }
  function MissingStory() {
    return (() => {
      var _el$25 = createElement("div"), _el$26 = createElement("strong"), _el$28 = createElement("span");
      insertNode(_el$25, _el$26);
      insertNode(_el$25, _el$28);
      setProp(_el$25, "class", "min-h-85 p-10 flex flex-col items-center justify-center gap-2 text-[#7c8790] text-center");
      insertNode(_el$26, createTextNode(`Story not found`));
      setProp(_el$26, "class", "text-[#26323d]");
      insertNode(_el$28, createTextNode(`Return to the feed and select another story.`));
      return _el$25;
    })();
  }
  var iconNode = [["path", {
    d: "m21 21-4.34-4.34",
    key: "14j7rj"
  }], ["circle", {
    cx: "11",
    cy: "11",
    r: "8",
    key: "4ej97u"
  }]];
  var Search = (props) => createComponent(Icon_default, mergeProps(props, {
    iconNode,
    name: "search"
  }));
  var search_default = Search;
  function LoadingList() {
    return (() => {
      var _el$ = createElement("div");
      setProp(_el$, "class", "w-full");
      insert(_el$, createComponent(For, {
        each: [1, 2, 3, 4, 5, 6],
        children: (item) => (() => {
          var _el$2 = createElement("div"), _el$3 = createElement("span"), _el$4 = createElement("div"), _el$5 = createElement("i"), _el$6 = createElement("i");
          insertNode(_el$2, _el$3);
          insertNode(_el$2, _el$4);
          setProp(_el$2, "class", "h-19.5 px-5.5 py-3.25 grid grid-cols-[38px_1fr] items-center gap-3 border-b border-[#edf0f1] text-[#c1c7cc] font-mono text-xs");
          insert(_el$3, () => String(item).padStart(2, "0"));
          insertNode(_el$4, _el$5);
          insertNode(_el$4, _el$6);
          setProp(_el$4, "class", "flex flex-col gap-2");
          setProp(_el$5, "class", "block w-70% h-2.25 rounded-sm bg-[#e8ebed]");
          setProp(_el$6, "class", "block w-38% h-1.75 rounded-sm bg-[#e8ebed]");
          return _el$2;
        })()
      }));
      return _el$;
    })();
  }
  function StoryList() {
    const navigate = useNavigate();
    const visibleStories = createMemo(() => {
      const needle = query().trim().toLowerCase();
      if (!needle) return stories();
      return stories().filter((story) => story.title.toLowerCase().includes(needle) || story.by.toLowerCase().includes(needle) || storyHost(story.url).includes(needle));
    });
    return (() => {
      var _el$ = createElement("section"), _el$2 = createElement("div"), _el$3 = createElement("div"), _el$4 = createElement("h1"), _el$6 = createElement("p"), _el$8 = createElement("label"), _el$9 = createElement("input"), _el$0 = createElement("div"), _el$10 = createElement("footer"), _el$11 = createElement("span"), _el$12 = createTextNode(` stories`), _el$13 = createElement("span");
      insertNode(_el$, _el$2);
      insertNode(_el$, _el$0);
      insertNode(_el$, _el$10);
      setProp(_el$, "class", "h-full min-h-0 flex flex-col bg-white overflow-hidden");
      insertNode(_el$2, _el$3);
      insertNode(_el$2, _el$8);
      setProp(_el$2, "class", "h-16 flex-none px-5 flex items-center gap-4 border-b border-[#dfe3e6] bg-[#f8f9fa]");
      insertNode(_el$3, _el$4);
      insertNode(_el$3, _el$6);
      setProp(_el$3, "class", "min-w-0");
      insertNode(_el$4, createTextNode(`Top stories`));
      setProp(_el$4, "class", "m-0 text-[#20272e] text-base font-650 leading-tight");
      insertNode(_el$6, createTextNode(`Ranked by the Hacker News community`));
      setProp(_el$6, "class", "m-0 mt-1 text-[#87919a] text-11px");
      insertNode(_el$8, _el$9);
      setProp(_el$8, "class", "w-60 ml-auto h-8 px-2.5 flex items-center gap-2 border border-[#cbd1d6] rounded bg-white text-[#78838d] focus-within:border-[#8e9aa5]");
      insert(_el$8, createComponent(search_default, {
        size: 15
      }), _el$9);
      setProp(_el$9, "class", "w-full min-w-0 border-0 outline-none bg-transparent text-[#26323d] text-13px");
      setProp(_el$9, "type", "text");
      setProp(_el$9, "placeholder", "Filter stories");
      setProp(_el$9, "aria-label", "Filter stories");
      setProp(_el$9, "onInput", (event) => setQuery(event.currentTarget.value));
      setProp(_el$0, "class", "flex-1 min-h-0 overflow-y-auto overflow-x-hidden");
      insert(_el$0, createComponent(Show, {
        get when() {
          return !loading() || stories().length > 0;
        },
        get fallback() {
          return createComponent(LoadingList, {});
        },
        get children() {
          return createComponent(Show, {
            get when() {
              return !loadError();
            },
            get fallback() {
              return createComponent(LoadError, {});
            },
            get children() {
              return createComponent(Show, {
                get when() {
                  return visibleStories().length > 0;
                },
                get fallback() {
                  return createComponent(EmptyState, {});
                },
                get children() {
                  var _el$1 = createElement("ol");
                  setProp(_el$1, "class", "m-0 p-0 list-none");
                  insert(_el$1, createComponent(For, {
                    get each() {
                      return visibleStories();
                    },
                    children: (story, index) => (() => {
                      var _el$15 = createElement("li"), _el$16 = createElement("span"), _el$17 = createElement("button"), _el$18 = createElement("span"), _el$19 = createElement("strong"), _el$20 = createElement("span"), _el$21 = createElement("span"), _el$22 = createElement("span"), _el$23 = createTextNode(` points`), _el$24 = createElement("span"), _el$25 = createTextNode(`by `), _el$26 = createElement("span"), _el$27 = createElement("button"), _el$28 = createElement("strong"), _el$29 = createElement("span");
                      insertNode(_el$15, _el$16);
                      insertNode(_el$15, _el$17);
                      insertNode(_el$15, _el$27);
                      setProp(_el$15, "class", "h-18 px-4 grid grid-cols-[32px_minmax(0,1fr)_64px] items-center gap-3 border-b border-[#e9ecee] hover:bg-[#f7f8f9]");
                      setProp(_el$16, "class", "text-[#a5adb4] font-mono text-xs");
                      insert(_el$16, () => String(index() + 1).padStart(2, "0"));
                      insertNode(_el$17, _el$18);
                      insertNode(_el$17, _el$21);
                      setProp(_el$17, "class", "min-w-0 p-0 border-0 bg-transparent text-left cursor-pointer");
                      setProp(_el$17, "type", "button");
                      setProp(_el$17, "onClick", () => navigate(`/story/${story.id}`));
                      insertNode(_el$18, _el$19);
                      insertNode(_el$18, _el$20);
                      setProp(_el$18, "class", "min-w-0 flex items-baseline gap-2");
                      setProp(_el$19, "class", "min-w-0 overflow-hidden text-[#20272e] text-13px font-600 leading-snug text-ellipsis whitespace-nowrap");
                      insert(_el$19, () => story.title);
                      setProp(_el$20, "class", "lt-md:hidden flex-none text-[#8b959e] text-11px");
                      insert(_el$20, () => storyHost(story.url));
                      insertNode(_el$21, _el$22);
                      insertNode(_el$21, _el$24);
                      insertNode(_el$21, _el$26);
                      setProp(_el$21, "class", "mt-1.5 flex gap-3.5 text-[#7c8790] text-11px");
                      insertNode(_el$22, _el$23);
                      insert(_el$22, () => story.score, _el$23);
                      insertNode(_el$24, _el$25);
                      insert(_el$24, () => story.by, null);
                      insert(_el$26, () => relativeTime(story.time));
                      insertNode(_el$27, _el$28);
                      insertNode(_el$27, _el$29);
                      setProp(_el$27, "class", "lt-md:hidden p-0 border-0 bg-transparent text-left cursor-pointer flex flex-col items-end text-[#8a949d] text-10px");
                      setProp(_el$27, "type", "button");
                      setProp(_el$27, "onClick", () => navigate(`/story/${story.id}`));
                      setProp(_el$28, "class", "text-[#44515c] text-15px");
                      insert(_el$28, () => story.descendants ?? 0);
                      insertNode(_el$29, createTextNode(`comments`));
                      return _el$15;
                    })()
                  }));
                  return _el$1;
                }
              });
            }
          });
        }
      }));
      insertNode(_el$10, _el$11);
      insertNode(_el$10, _el$13);
      setProp(_el$10, "class", "h-8 flex-none px-4 flex items-center justify-between border-t border-[#dfe3e6] bg-[#f5f6f7] text-[#7f8992] text-10px");
      insertNode(_el$11, _el$12);
      insert(_el$11, () => visibleStories().length, _el$12);
      insertNode(_el$13, createTextNode(`Updated from Hacker News API`));
      effect((_$p) => setProp(_el$9, "value", query(), _$p));
      return _el$;
    })();
  }
  function LoadError() {
    return (() => {
      var _el$31 = createElement("div"), _el$32 = createElement("strong"), _el$34 = createElement("span"), _el$35 = createElement("button");
      insertNode(_el$31, _el$32);
      insertNode(_el$31, _el$34);
      insertNode(_el$31, _el$35);
      setProp(_el$31, "class", "min-h-85 p-10 flex flex-col items-center justify-center gap-2 text-[#7c8790] text-center");
      insertNode(_el$32, createTextNode(`Stories could not be loaded`));
      setProp(_el$32, "class", "text-[#26323d]");
      setProp(_el$34, "class", "text-[#b34b3e]");
      insert(_el$34, loadError);
      insertNode(_el$35, createTextNode(`Try again`));
      setProp(_el$35, "class", "mt-3 px-3.5 py-2 border border-[#cbd1d6] rounded bg-white cursor-pointer");
      setProp(_el$35, "type", "button");
      setProp(_el$35, "onClick", () => void loadStories());
      return _el$31;
    })();
  }
  function EmptyState() {
    return (() => {
      var _el$37 = createElement("div"), _el$38 = createElement("strong"), _el$40 = createElement("span");
      insertNode(_el$37, _el$38);
      insertNode(_el$37, _el$40);
      setProp(_el$37, "class", "min-h-85 p-10 flex flex-col items-center justify-center gap-2 text-[#7c8790] text-center");
      insertNode(_el$38, createTextNode(`No matching stories`));
      setProp(_el$38, "class", "text-[#26323d]");
      insertNode(_el$40, createTextNode(`Try a different title, author, or domain.`));
      return _el$37;
    })();
  }
  mount(() => createComponent(MemoryRouter, {
    root: AppShell,
    get children() {
      return [createComponent(Route, {
        path: "/",
        component: StoryList
      }), createComponent(Route, {
        path: "/story/:id",
        component: StoryDetail
      })];
    }
  }));
})();
