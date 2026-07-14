//! Binary bridge wire protocol.
//!
//! Frame layout (all little-endian):
//!   [seq: u32][count: u16][op...]
//! Each op: [op: u8][operands...]. Strings: [len: u16][utf8].
//! Node ids are u32; 0 is the "none / append" sentinel.

#![allow(dead_code)]

// Opcode + event-code constants are generated from the TS source of truth
// (packages/protocol/src/index.ts) by `bun run gen`. See scripts/gen-rust-op.ts.
include!("gen/op.rs");

/// A decoded operation. String operands borrow from the frame buffer
/// (`'a`) so decode is allocation-free; the applier owns them into `String`s.
#[derive(Debug)]
pub enum Op<'a> {
    CreateElement {
        id: u32,
        tag: &'a str,
        attrs: Vec<(&'a str, &'a str)>,
    },
    CreateText {
        id: u32,
        text: &'a str,
    },
    CreateComment {
        id: u32,
        text: &'a str,
    },
    AppendChild {
        parent: u32,
        child: u32,
    },
    InsertBefore {
        parent: u32,
        child: u32,
        ref_id: u32,
    },
    RemoveChild {
        parent: u32,
        child: u32,
    },
    ReplaceNode {
        parent: u32,
        old_id: u32,
        new_id: u32,
    },
    SetText {
        id: u32,
        text: &'a str,
    },
    SetAttribute {
        id: u32,
        name: &'a str,
        value: &'a str,
    },
    RemoveAttribute {
        id: u32,
        name: &'a str,
    },
    SetStyle {
        id: u32,
        prop: &'a str,
        value: &'a str,
    },
    RemoveStyle {
        id: u32,
        prop: &'a str,
    },
    AddEventListener {
        id: u32,
        event_type: u8,
    },
    RemoveEventListener {
        id: u32,
        event_type: u8,
    },
    SetClassName {
        id: u32,
        value: &'a str,
    },
    FrameEnd,
    DropNode {
        id: u32,
    },
}

/// Decoded frame.
#[derive(Debug)]
pub struct Frame<'a> {
    pub seq: u32,
    pub ops: Vec<Op<'a>>,
}

#[derive(Debug)]
pub enum DecodeError {
    UnexpectedEof,
    BadOp(u8),
    BadUtf8,
}

impl std::fmt::Display for DecodeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            DecodeError::UnexpectedEof => write!(f, "unexpected end of frame"),
            DecodeError::BadOp(b) => write!(f, "unknown opcode 0x{b:02x}"),
            DecodeError::BadUtf8 => write!(f, "invalid utf-8 in string operand"),
        }
    }
}
impl std::error::Error for DecodeError {}

struct Reader<'a> {
    b: &'a [u8],
    pos: usize,
}

impl<'a> Reader<'a> {
    fn new(b: &'a [u8]) -> Self {
        Self { b, pos: 0 }
    }
    fn u8(&mut self) -> Result<u8, DecodeError> {
        let v = self
            .b
            .get(self.pos)
            .copied()
            .ok_or(DecodeError::UnexpectedEof)?;
        self.pos += 1;
        Ok(v)
    }
    fn u16(&mut self) -> Result<u16, DecodeError> {
        if self.pos + 2 > self.b.len() {
            return Err(DecodeError::UnexpectedEof);
        }
        let v = u16::from_le_bytes([self.b[self.pos], self.b[self.pos + 1]]);
        self.pos += 2;
        Ok(v)
    }
    fn u32(&mut self) -> Result<u32, DecodeError> {
        if self.pos + 4 > self.b.len() {
            return Err(DecodeError::UnexpectedEof);
        }
        let v = u32::from_le_bytes([
            self.b[self.pos],
            self.b[self.pos + 1],
            self.b[self.pos + 2],
            self.b[self.pos + 3],
        ]);
        self.pos += 4;
        Ok(v)
    }
    fn str(&mut self) -> Result<&'a str, DecodeError> {
        let len = self.u16()? as usize;
        if self.pos + len > self.b.len() {
            return Err(DecodeError::UnexpectedEof);
        }
        let s = std::str::from_utf8(&self.b[self.pos..self.pos + len])
            .map_err(|_| DecodeError::BadUtf8)?;
        self.pos += len;
        Ok(s)
    }
}

pub fn decode_frame(buf: &[u8]) -> Result<Frame<'_>, DecodeError> {
    let mut r = Reader::new(buf);
    let seq = r.u32()?;
    let count = r.u16()?;
    let mut ops = Vec::with_capacity(count as usize);
    for _ in 0..count {
        ops.push(decode_op(&mut r)?);
    }
    Ok(Frame { seq, ops })
}

fn decode_op<'a>(r: &mut Reader<'a>) -> Result<Op<'a>, DecodeError> {
    let code = r.u8()?;
    Ok(match code {
        op::CREATE_ELEMENT => {
            let id = r.u32()?;
            let tag = r.str()?;
            let n_attr = r.u16()?;
            let mut attrs = Vec::with_capacity(n_attr as usize);
            for _ in 0..n_attr {
                let name = r.str()?;
                let value = r.str()?;
                attrs.push((name, value));
            }
            Op::CreateElement { id, tag, attrs }
        }
        op::CREATE_TEXT => {
            let id = r.u32()?;
            let text = r.str()?;
            Op::CreateText { id, text }
        }
        op::CREATE_COMMENT => {
            let id = r.u32()?;
            let text = r.str()?;
            Op::CreateComment { id, text }
        }
        op::APPEND_CHILD => {
            let parent = r.u32()?;
            let child = r.u32()?;
            Op::AppendChild { parent, child }
        }
        op::INSERT_BEFORE => {
            let parent = r.u32()?;
            let child = r.u32()?;
            let ref_id = r.u32()?;
            Op::InsertBefore {
                parent,
                child,
                ref_id,
            }
        }
        op::REMOVE_CHILD => {
            let parent = r.u32()?;
            let child = r.u32()?;
            Op::RemoveChild { parent, child }
        }
        op::REPLACE_NODE => {
            let parent = r.u32()?;
            let old_id = r.u32()?;
            let new_id = r.u32()?;
            Op::ReplaceNode {
                parent,
                old_id,
                new_id,
            }
        }
        op::SET_TEXT => {
            let id = r.u32()?;
            let text = r.str()?;
            Op::SetText { id, text }
        }
        op::SET_ATTRIBUTE => {
            let id = r.u32()?;
            let name = r.str()?;
            let value = r.str()?;
            Op::SetAttribute { id, name, value }
        }
        op::REMOVE_ATTRIBUTE => {
            let id = r.u32()?;
            let name = r.str()?;
            Op::RemoveAttribute { id, name }
        }
        op::SET_STYLE => {
            let id = r.u32()?;
            let prop = r.str()?;
            let value = r.str()?;
            Op::SetStyle { id, prop, value }
        }
        op::REMOVE_STYLE => {
            let id = r.u32()?;
            let prop = r.str()?;
            Op::RemoveStyle { id, prop }
        }
        op::ADD_EVENT_LISTENER => {
            let id = r.u32()?;
            let event_type = r.u8()?;
            Op::AddEventListener { id, event_type }
        }
        op::REMOVE_EVENT_LISTENER => {
            let id = r.u32()?;
            let event_type = r.u8()?;
            Op::RemoveEventListener { id, event_type }
        }
        op::SET_CLASS_NAME => {
            let id = r.u32()?;
            let value = r.str()?;
            Op::SetClassName { id, value }
        }
        op::FRAME_END => Op::FrameEnd,
        op::DROP_NODE => {
            let id = r.u32()?;
            Op::DropNode { id }
        }
        other => return Err(DecodeError::BadOp(other)),
    })
}

// ---------------------------------------------------------------------------
// Encoder — used by tests; the JS side has its own writer, but we keep a Rust
// encoder so the protocol is symmetric and testable without QuickJS.
// ---------------------------------------------------------------------------

pub struct Encoder {
    buf: Vec<u8>,
    count: u16,
}

impl Encoder {
    pub fn new(seq: u32) -> Self {
        let mut buf = Vec::with_capacity(256);
        buf.extend_from_slice(&seq.to_le_bytes());
        buf.extend_from_slice(&0u16.to_le_bytes()); // count placeholder
        Self { buf, count: 0 }
    }

    fn u8(&mut self, v: u8) {
        self.buf.push(v);
    }
    fn u16(&mut self, v: u16) {
        self.buf.extend_from_slice(&v.to_le_bytes());
    }
    fn u32(&mut self, v: u32) {
        self.buf.extend_from_slice(&v.to_le_bytes());
    }
    fn str(&mut self, s: &str) {
        let len = s.len().min(u16::MAX as usize) as u16;
        self.u16(len);
        self.buf.extend_from_slice(&s.as_bytes()[..len as usize]);
    }

    pub fn create_element(&mut self, id: u32, tag: &str, attrs: &[(&str, &str)]) {
        self.u8(op::CREATE_ELEMENT);
        self.u32(id);
        self.str(tag);
        self.u16(attrs.len() as u16);
        for (n, v) in attrs {
            self.str(n);
            self.str(v);
        }
        self.count += 1;
    }
    pub fn create_text(&mut self, id: u32, text: &str) {
        self.u8(op::CREATE_TEXT);
        self.u32(id);
        self.str(text);
        self.count += 1;
    }
    pub fn append_child(&mut self, parent: u32, child: u32) {
        self.u8(op::APPEND_CHILD);
        self.u32(parent);
        self.u32(child);
        self.count += 1;
    }
    pub fn insert_before(&mut self, parent: u32, child: u32, ref_id: u32) {
        self.u8(op::INSERT_BEFORE);
        self.u32(parent);
        self.u32(child);
        self.u32(ref_id);
        self.count += 1;
    }
    pub fn set_text(&mut self, id: u32, text: &str) {
        self.u8(op::SET_TEXT);
        self.u32(id);
        self.str(text);
        self.count += 1;
    }
    pub fn set_attribute(&mut self, id: u32, name: &str, value: &str) {
        self.u8(op::SET_ATTRIBUTE);
        self.u32(id);
        self.str(name);
        self.str(value);
        self.count += 1;
    }
    pub fn set_class_name(&mut self, id: u32, value: &str) {
        self.u8(op::SET_CLASS_NAME);
        self.u32(id);
        self.str(value);
        self.count += 1;
    }

    /// Finalize: patch in the op count and return the buffer.
    pub fn finish(mut self) -> Vec<u8> {
        self.buf[4..6].copy_from_slice(&self.count.to_le_bytes());
        self.buf
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip() {
        // Build a frame by hand so the count is correct.
        let mut buf = Vec::new();
        let seq = 7u32;
        buf.extend_from_slice(&seq.to_le_bytes());
        buf.extend_from_slice(&3u16.to_le_bytes()); // 3 ops

        // CreateElement id=1 "div" with one attr
        buf.push(op::CREATE_ELEMENT);
        buf.extend_from_slice(&1u32.to_le_bytes());
        buf.extend_from_slice(&3u16.to_le_bytes());
        buf.extend_from_slice(b"div");
        buf.extend_from_slice(&1u16.to_le_bytes()); // nattr
        buf.extend_from_slice(&5u16.to_le_bytes());
        buf.extend_from_slice(b"class");
        buf.extend_from_slice(&3u16.to_le_bytes());
        buf.extend_from_slice(b"box");
        // CreateText id=2 "hi"
        buf.push(op::CREATE_TEXT);
        buf.extend_from_slice(&2u32.to_le_bytes());
        buf.extend_from_slice(&2u16.to_le_bytes());
        buf.extend_from_slice(b"hi");
        // AppendChild parent=1 child=2
        buf.push(op::APPEND_CHILD);
        buf.extend_from_slice(&1u32.to_le_bytes());
        buf.extend_from_slice(&2u32.to_le_bytes());

        let frame = decode_frame(&buf).expect("decode");
        assert_eq!(frame.seq, 7);
        assert_eq!(frame.ops.len(), 3);
        match &frame.ops[0] {
            Op::CreateElement { id, tag, attrs } => {
                assert_eq!(*id, 1);
                assert_eq!(*tag, "div");
                assert_eq!(attrs.len(), 1);
                assert_eq!(attrs[0].0, "class");
                assert_eq!(attrs[0].1, "box");
            }
            other => panic!("unexpected {other:?}"),
        }
        match &frame.ops[1] {
            Op::CreateText { id, text } => {
                assert_eq!(*id, 2);
                assert_eq!(*text, "hi");
            }
            other => panic!("unexpected {other:?}"),
        }
        match &frame.ops[2] {
            Op::AppendChild { parent, child } => {
                assert_eq!(*parent, 1);
                assert_eq!(*child, 2);
            }
            other => panic!("unexpected {other:?}"),
        }
    }

    #[test]
    fn encoder_roundtrip() {
        let mut e = Encoder::new(42);
        e.create_element(1, "div", &[("class", "box"), ("id", "a")]);
        e.create_text(2, "hello");
        e.append_child(1, 2);
        e.set_text(2, "world");
        let buf = e.finish();

        let frame = decode_frame(&buf).expect("decode");
        assert_eq!(frame.seq, 42);
        assert_eq!(frame.ops.len(), 4);
        assert!(matches!(
            frame.ops[0],
            Op::CreateElement {
                id: 1,
                tag: "div",
                ..
            }
        ));
        assert!(matches!(
            frame.ops[3],
            Op::SetText {
                id: 2,
                text: "world"
            }
        ));
    }

    /// Drift guard: every opcode constant emitted by codegen (from the TS
    /// source of truth) must be (a) unique and (b) decodable into a known Op
    /// variant. Catches a stale `gen/op.rs` after an opcode is added or
    /// renumbered in packages/protocol without re-running `bun run gen`.
    #[test]
    fn all_opcodes_decode() {
        let codes = [
            op::CREATE_ELEMENT,
            op::CREATE_TEXT,
            op::CREATE_COMMENT,
            op::APPEND_CHILD,
            op::INSERT_BEFORE,
            op::REMOVE_CHILD,
            op::REPLACE_NODE,
            op::SET_TEXT,
            op::SET_ATTRIBUTE,
            op::REMOVE_ATTRIBUTE,
            op::SET_STYLE,
            op::REMOVE_STYLE,
            op::ADD_EVENT_LISTENER,
            op::REMOVE_EVENT_LISTENER,
            op::SET_CLASS_NAME,
            op::FRAME_END,
        ];
        // uniqueness
        let mut seen = std::collections::HashSet::new();
        for &c in &codes {
            assert!(seen.insert(c), "duplicate opcode 0x{c:02x}");
        }

        // Each must decode (build a minimal frame per opcode with enough trailing
        // bytes for the largest operand set, then ensure no BadOp).
        for &c in &codes {
            let mut buf = Vec::new();
            buf.extend_from_slice(&0u32.to_le_bytes()); // seq
            buf.extend_from_slice(&1u16.to_le_bytes()); // count
            buf.push(c);
            // Pad with plenty of operand bytes (u32 ids, u16 lens, strings).
            buf.extend_from_slice(&[0u8; 64]);
            match decode_frame(&buf) {
                Ok(_) => {}
                Err(DecodeError::BadOp(b)) => panic!("opcode 0x{b:02x} not handled by decoder"),
                // Operand-shortage is fine — we only care it wasn't BadOp.
                Err(DecodeError::UnexpectedEof) | Err(DecodeError::BadUtf8) => {}
            }
        }
    }
}
