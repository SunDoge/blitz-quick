# blitz-quick Architecture: Node ID Mapping

## Why two ID systems?

blitz-quick runs **two independent node trees** in parallel:

| Tree                   | Owner             | ID type            | Purpose                                                                         |
| ---------------------- | ----------------- | ------------------ | ------------------------------------------------------------------------------- |
| **Solid virtual tree** | QuickJS (JS side) | `u32` (Solid id)   | Reactive UI — SolidJS reconciler tracks components, reactivity, event listeners |
| **Blitz DOM tree**     | Rust (blitz-dom)  | `usize` (blitz id) | Rendering — layout, paint, hit-testing, scrolling                               |

SolidJS owns the "what" (reactive state → which nodes exist, their props, their event
handlers). Blitz-dom owns the "how" (layout boxes, paint commands, hit-test geometry).

The two trees **must stay in sync**: when SolidJS creates/updates/removes a node, the
Applier translates that into a blitz-dom mutation. When blitz-dom fires an event (click,
scroll, focus), the Applier must route it back to the correct SolidJS handler.

This requires **bidirectional ID mapping**.

## The two maps

### `id_map: Vec<Option<GenerationNode>>` — Solid → Blitz (forward path)

**Used when:** applying protocol ops from JS. Every op (`CreateElement`, `AppendChild`,
`SetProp`, `RemoveChild`, ...) carries a Solid id. The Applier must translate it to a
blitz node id to call `blitz_dom::DocumentMutator` methods.

**Structure:** a flat array indexed by the **slot** (lower 20 bits of the Solid id).
Each slot holds `GenerationNode { generation, blitz_id }`.

**Why a Vec, not a HashMap?** Solid ids are compact integers starting from 2 (1 is the
root). The slot space is dense, so a Vec with direct indexing is O(1) and cache-friendly.

**Why generation?** SolidJS recycles slots when a component is destroyed and a new one
is created — the same slot number is reused with a higher generation (upper 12 bits).
Without generation checks, a stale mapping (old component at slot N) would be confused
with the new component (also slot N, different generation). The `get()` method rejects
mismatches:

```
solid_id = (generation << 20) | slot
           \_____________________/ \___/
             12 bits (version)    20 bits (index)
```

### `blitz_to_solid: HashMap<usize, u32>` — Blitz → Solid (return path)

**Used when:** blitz-dom emits events (click, input, focus, scroll...). The event
carries a blitz node id (the hit-test target). The Applier must find the SolidJS handler
that registered a listener on that node — which means translating blitz id → Solid id
→ look up `listenersBySlot` in the JS renderer.

**Why a HashMap?** Blitz ids are `usize` slab indices — they can be large and sparse
(blitz inserts anonymous wrapper nodes, table structures, etc. that have no Solid
counterpart). A HashMap handles the sparse key space.

**Why walk up the parent chain?** Blitz-dom inserts **anonymous nodes** (anonymous block
boxes, table wrappers) that have no SolidJS equivalent. When a pointer event hits one of
these, `solid_id_for()` walks up the blitz parent chain until it finds a node that IS in
`blitz_to_solid`. This is why `solid_id_for` is a loop, not a single lookup:

```rust
fn solid_id_for(&self, mut blitz_id: usize) -> Option<u32> {
    loop {
        if let Some(&sid) = self.blitz_to_solid.get(&blitz_id) {
            return Some(sid);
        }
        blitz_id = self.doc.get_node(blitz_id)?.parent?;
    }
}
```

## The sync lifecycle

### Forward: JS → Rust (each rAF tick)

1. SolidJS reconciler runs in QuickJS, produces mutations.
2. The `Writer` in `@blitz-quick/solid-renderer` serializes each mutation as a binary
   op (`CreateElement`, `AppendChild`, `SetProp`, ...), each carrying a Solid id.
3. `__bridge_flush` sends the frame bytes to Rust.
4. `Applier::apply_frame` decodes the ops and, for each, translates Solid id → blitz id
   via `id_map`, then calls the corresponding `DocumentMutator` method.
5. For `CreateElement`: a new blitz node is created, and both maps are updated
   (`id_map[slot] = GenerationNode { blitz_id, generation }` and
   `blitz_to_solid.insert(blitz_id, solid_id)`).
6. For `DropNode`: the blitz node is removed, and both maps are cleaned up
   (`id_map[slot] = None` and `blitz_to_solid.remove(&blitz_id)`).

### Return: Rust → JS (events)

1. blitz-dom's `EventDriver` processes a `UiEvent` (mouse move, key press, etc.),
   performs hit-testing, bubbling, and synthesizes DOM events (click, enter, leave,
   focus, blur, input, ...).
2. Each emitted `DomEvent` carries `target: usize` (a blitz node id).
3. `Applier::handle_ui_event` translates blitz id → Solid id via
   `solid_id_for(dom_event.target)`.
4. The event is dispatched into JS via `dispatchEvent(solidId, eventCode, payload)`.
5. The JS renderer walks the Solid handle tree from that id, bubbling to ancestors
   and firing any matching `onXxx` listener.

### Why not use a single ID space?

Blitz-dom's `Slab<Node>` assigns ids sequentially and may insert nodes the JS side
never sees (anonymous blocks, table wrappers, pseudo-elements). SolidJS's reconciler
assigns ids from its own slot pool with generation recycling. The two allocation
strategies are incompatible — a unified ID space would require either:

- Making blitz-dom's slab externally addressable (breaks encapsulation), or
- Making SolidJS use blitz-dom ids (couples the JS reconciler to Rust internals).

The mapping layer keeps both systems autonomous and bridges them at the Applier
boundary, which is the only place that touches both.
