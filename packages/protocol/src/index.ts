// @blitz-quick/protocol — single source of truth for the binary bridge wire format.
//
// OP and EVENT_CODE here are the SOT. Rust constants are generated from them
// by `bun run gen` (scripts/gen-rust-op.ts → src/gen/op.rs, include!d by
// src/protocol.rs). A drift-guard test in protocol.rs asserts every opcode
// decodes, so a stale regen surfaces as a test failure.

export const OP = {
  CreateElement: 0x01,
  CreateText: 0x02,
  CreateComment: 0x03,
  AppendChild: 0x04,
  InsertBefore: 0x05,
  RemoveChild: 0x06,
  ReplaceNode: 0x07,
  SetText: 0x08,
  SetAttribute: 0x09,
  RemoveAttribute: 0x0a,
  SetStyle: 0x0b,
  RemoveStyle: 0x0c,
  AddEventListener: 0x0d,
  RemoveEventListener: 0x0e,
  SetClassName: 0x0f,
  FrameEnd: 0x10,
  DropNode: 0x11,
} as const;

export type OpCode = (typeof OP)[keyof typeof OP];

export const EVENT_CODE = {
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
} as const;

export type EventType = keyof typeof EVENT_CODE;

export const EVENT_DATA_SLOT = {
  clientX: 0,
  clientY: 1,
  button: 2,
  buttons: 3,
  mods: 4,
  deltaX: 5,
  deltaY: 6,
} as const;

export const EVENT_DATA_LEN = Object.keys(EVENT_DATA_SLOT).length;
export type EventDataSlot = keyof typeof EVENT_DATA_SLOT;

const encoder = typeof TextEncoder !== "undefined" ? new TextEncoder() : null;

function utf8Encode(s: string): Uint8Array | number[] {
  if (encoder) return encoder.encode(s);
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else if (c >= 0xd800 && c <= 0xdbff) {
      const c2 = s.charCodeAt(++i);
      const cp = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff);
      out.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f),
      );
    } else {
      out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    }
  }
  return out;
}

/**
 * Per-tick binary frame writer. Emits ops into an internal buffer; `flush()`
 * returns the complete frame (header + ops) or null if nothing was emitted.
 * The caller owns how the bytes cross the bridge (see apps/demo host glue).
 */
export class Writer {
  private buf = new Uint8Array(4096);
  private cursor = 6; // Reserve first 6 bytes for header
  private count = 0;
  private seq = 0;

  private ensure(n: number): void {
    if (this.cursor + n <= this.buf.length) return;
    let cap = this.buf.length;
    while (cap < this.cursor + n) cap *= 2;
    const next = new Uint8Array(cap);
    next.set(this.buf);
    this.buf = next;
  }

  private u8(v: number): void {
    this.ensure(1);
    this.buf[this.cursor++] = v & 0xff;
  }
  private u16(v: number): void {
    this.ensure(2);
    const c = this.cursor;
    this.buf[c] = v & 0xff;
    this.buf[c + 1] = (v >> 8) & 0xff;
    this.cursor += 2;
  }
  private u32(v: number): void {
    this.ensure(4);
    const c = this.cursor;
    this.buf[c] = v & 0xff;
    this.buf[c + 1] = (v >> 8) & 0xff;
    this.buf[c + 2] = (v >> 16) & 0xff;
    this.buf[c + 3] = (v >> 24) & 0xff;
    this.cursor += 4;
  }
  private str(s: string): void {
    const bytes = utf8Encode(s);
    this.u16(bytes.length & 0xffff);
    this.ensure(bytes.length);
    this.buf.set(bytes, this.cursor);
    this.cursor += bytes.length;
  }

  private emit(op: OpCode): void {
    this.u8(op);
    this.count++;
  }

  createElement(
    id: number,
    tag: string,
    attrs: [string, string][] | null = null,
  ): void {
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
  createText(id: number, text: string): void {
    this.emit(OP.CreateText);
    this.u32(id);
    this.str(text);
  }
  createComment(id: number, text: string): void {
    this.emit(OP.CreateComment);
    this.u32(id);
    this.str(text);
  }
  appendChild(parent: number, child: number): void {
    this.emit(OP.AppendChild);
    this.u32(parent);
    this.u32(child);
  }
  insertBefore(parent: number, child: number, ref: number): void {
    this.emit(OP.InsertBefore);
    this.u32(parent);
    this.u32(child);
    this.u32(ref);
  }
  removeChild(parent: number, child: number): void {
    this.emit(OP.RemoveChild);
    this.u32(parent);
    this.u32(child);
  }
  replaceNode(parent: number, oldId: number, newId: number): void {
    this.emit(OP.ReplaceNode);
    this.u32(parent);
    this.u32(oldId);
    this.u32(newId);
  }
  setText(id: number, text: string): void {
    this.emit(OP.SetText);
    this.u32(id);
    this.str(text);
  }
  setAttribute(id: number, name: string, value: string): void {
    this.emit(OP.SetAttribute);
    this.u32(id);
    this.str(name);
    this.str(value);
  }
  removeAttribute(id: number, name: string): void {
    this.emit(OP.RemoveAttribute);
    this.u32(id);
    this.str(name);
  }
  setStyle(id: number, prop: string, value: string): void {
    this.emit(OP.SetStyle);
    this.u32(id);
    this.str(prop);
    this.str(value);
  }
  removeStyle(id: number, prop: string): void {
    this.emit(OP.RemoveStyle);
    this.u32(id);
    this.str(prop);
  }
  addEventListener(id: number, eventCode: number): void {
    this.emit(OP.AddEventListener);
    this.u32(id);
    this.u8(eventCode);
  }
  removeEventListener(id: number, eventCode: number): void {
    this.emit(OP.RemoveEventListener);
    this.u32(id);
    this.u8(eventCode);
  }
  setClassName(id: number, value: string): void {
    this.emit(OP.SetClassName);
    this.u32(id);
    this.str(value);
  }
  frameEnd(): void {
    this.emit(OP.FrameEnd);
  }
  dropNode(id: number): void {
    this.emit(OP.DropNode);
    this.u32(id);
  }

  /** Drain the buffer into a frame, or null if no ops were emitted this tick. */
  flush(): Uint8Array | null {
    if (this.count === 0) return null;
    this.seq++;
    const s = this.seq;
    this.buf[0] = s & 0xff;
    this.buf[1] = (s >> 8) & 0xff;
    this.buf[2] = (s >> 16) & 0xff;
    this.buf[3] = (s >> 24) & 0xff;
    this.buf[4] = this.count & 0xff;
    this.buf[5] = (this.count >> 8) & 0xff;
    const out = this.buf.subarray(0, this.cursor);
    this.cursor = 6;
    this.count = 0;
    return out;
  }
}
