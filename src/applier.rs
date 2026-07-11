//! Apply decoded protocol ops to a blitz-dom document.
//!
//! The applier owns the `HtmlDocument` and a mapping from Solid-side virtual
//! node ids (`u32`) to blitz slab node ids (`usize`). Each frame is decoded by
//! `protocol::decode_frame` and applied in order.

use std::collections::{HashMap, HashSet};
use std::sync::mpsc;

use blitz::dom::node::Attribute;
use blitz::dom::{
    BaseDocument, DEFAULT_CSS, DocGuard, DocGuardMut, Document as BlitzDocument, DocumentConfig,
    DocumentMutator, LocalName, QualName, ns,
};
use blitz::html::HtmlDocument;
use blitz::traits::events::{BlitzKeyEvent, BlitzPointerEvent, BlitzWheelDelta, UiEvent};
use blitz::traits::shell::{ColorScheme, Viewport};

use crate::jsrt::{JsRuntime, TimerCmd};
use crate::protocol::{Frame, Op, event};

/// Render scale (hidpi). Affects viewport sizing and paint_scene's scale.
pub const RENDER_SCALE: f64 = 2.0;
pub const RENDER_WIDTH: u32 = 800;
pub const RENDER_HEIGHT: u32 = 600;

#[derive(Debug, Clone, Copy)]
pub struct GenerationNode {
    pub generation: u16,
    pub blitz_id: usize,
}

/// An `Applier` is a blitz `Document` that drives a Solid app on QuickJS.
/// On each `poll()` it runs one rAF tick (JS → binary frame → apply ops to the
/// underlying `HtmlDocument`) and returns true while rAF callbacks remain
/// queued, so blitz-shell keeps redrawing at vsync.
pub struct Applier {
    pub doc: HtmlDocument,
    /// The QuickJS runtime running the bundled Solid app. None only briefly
    /// during construction (before boot).
    pub js: JsRuntime,
    /// Solid virtual id (slot) -> blitz node id + generation.
    id_map: Vec<Option<GenerationNode>>,
    /// Inverse: blitz node id -> full Solid virtual id (for event return path).
    blitz_to_solid: HashMap<usize, u32>,
    /// root mount node (blitz id) — Solid top-level appends here.
    root_blitz_id: usize,
    /// Tracked event listeners (solidId -> set of event type bytes), for the
    /// event return path (see DESIGN.md §6).
    pub listeners: HashMap<u32, HashSet<u8>>,
    /// Receives reload signals from the bundle.js/css file watcher (see
    /// `start_bundle_watcher`). Checked each `poll()` on the main thread.
    /// None in --screenshot mode (no watcher started).
    reload_rx: Option<mpsc::Receiver<ReloadMsg>>,
    timers: Vec<ActiveTimer>,
    waker: Option<std::task::Waker>,
    last_spawned_wake: Option<std::time::Instant>,
    /// blitz-net-backed fetch bridge: JS `fetch()` → tokio → completions drained
    /// in poll. Shared (Arc) so worker threads can push completions + wake.
    fetch: std::sync::Arc<crate::fetch::FetchBridge>,
    /// Callback to initialize the QuickJS runtime with custom globals before boot.
    on_runtime_init: Box<dyn Fn(&JsRuntime)>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReloadMsg {
    Js,
    Css,
}

struct ActiveTimer {
    id: u32,
    expires_at: std::time::Instant,
    delay_ms: u64,
    repeat: bool,
}

const BUNDLE_CSS: &str = include_str!("gen/bundle.css");

fn qual(tag: &str) -> QualName {
    QualName::new(None, ns!(html), LocalName::from(tag))
}

impl Applier {
    /// Build a document by parsing a minimal HTML shell with #root, then
    /// loading DEFAULT_CSS as the UA stylesheet. The app's own stylesheet
    /// (UnoCSS) is NOT loaded here — the JS side renders it into a <style>
    /// node (blitz-dom parses <style> textContent as an author stylesheet on
    /// flush), so CSS rides along the normal DOM ops and is hot-reloadable
    /// from JS without touching Rust. We use the real HTML parser (not
    /// hand-built nodes) so the document has the structure stylo's layout
    /// expects (html>head+body), which is required for non-zero layout.
    pub fn new(on_runtime_init: Box<dyn Fn(&JsRuntime)>) -> Self {
        let config = DocumentConfig {
            ua_stylesheets: Some(vec![DEFAULT_CSS.to_string()]),
            viewport: Some(Viewport::new(
                (RENDER_WIDTH as f64 * RENDER_SCALE) as u32,
                (RENDER_HEIGHT as f64 * RENDER_SCALE) as u32,
                RENDER_SCALE as f32,
                ColorScheme::Light,
            )),
            ..DocumentConfig::default()
        };
        let html_shell = format!(
            r#"<!DOCTYPE html><html><head><meta charset="utf-8"><style>{}</style></head><body><div id="root"></div></body></html>"#,
            BUNDLE_CSS
        );
        let doc = HtmlDocument::from_html(&html_shell, config);
        let root_blitz_id = doc
            .query_selector("#root")
            .ok()
            .flatten()
            .unwrap_or_else(|| doc.root_node().id);
        let js = JsRuntime::new().expect("failed to create QuickJS runtime");
        let fetch = std::sync::Arc::new(crate::fetch::FetchBridge::new());
        js.register_fetch(fetch.clone())
            .expect("failed to register fetch host fn");

        // Let the user register their FFI methods
        on_runtime_init(&js);

        let mut applier = Applier {
            doc,
            js,
            id_map: Vec::new(),
            blitz_to_solid: HashMap::new(),
            root_blitz_id,
            listeners: HashMap::new(),
            reload_rx: None,
            timers: Vec::new(),
            waker: None,
            last_spawned_wake: None,
            fetch,
            on_runtime_init,
        };
        applier
            .js
            .boot(&crate::jsrt::read_bundle_js())
            .expect("failed to boot app");
        applier
    }

    /// Run one JS rAF tick and apply the resulting frame to the document.
    /// Returns the number of ops applied this tick. A JS exception or a
    /// malformed frame is logged and dropped (treated as zero ops) rather than
    /// panicking — one bad tick must not take down the whole app.
    pub fn tick_once(&mut self) -> usize {
        let bytes = match self.js.tick() {
            Ok((bytes, _has_raf)) => bytes,
            Err(e) => {
                tracing::error!(target: "bridge", "JS tick failed: {e:?}");
                return 0;
            }
        };
        if bytes.is_empty() {
            return 0;
        }
        let frame = match crate::protocol::decode_frame(&bytes) {
            Ok(frame) => frame,
            Err(e) => {
                tracing::error!(target: "bridge", "decode frame failed: {e}");
                return 0;
            }
        };
        let n = frame.ops.len();
        self.apply_frame(&frame);
        n
    }

    /// Hot-reload: drop the old QuickJS runtime (with all Solid state) and
    /// boot a fresh one from the current bundle.js on disk, then clear the
    /// mounted DOM so Solid's initial render re-creates it. The window and
    /// event loop are untouched — only the JS side is rebuilt.
    pub fn reload_js(&mut self) {
        // Rebuild the runtime + re-eval the bundle read fresh from disk, so a
        // dev rebuild (`vite build --watch` regenerating src/gen/bundle.js) is
        // picked up without recompiling Rust. Falls back to the compile-time
        // bundle if the file is absent (release without a source tree).
        let mut js = JsRuntime::new().expect("failed to create QuickJS runtime");
        js.register_fetch(self.fetch.clone())
            .expect("failed to register fetch host fn");

        (self.on_runtime_init)(&js);

        js.boot(&crate::jsrt::read_bundle_js())
            .expect("failed to boot app");
        self.js = js;

        // Clear everything Solid mounted under #root: drop the blitz child
        // nodes and forget all id mappings, so the new render's ids don't
        // collide with stale entries.
        let child_ids: Vec<usize> = self
            .doc
            .get_node(self.root_blitz_id)
            .map(|n| n.children.clone())
            .unwrap_or_default();
        {
            let mut mutr = self.doc.mutate();
            for cid in &child_ids {
                mutr.remove_node(*cid);
            }
        }
        self.id_map.clear();
        self.blitz_to_solid.clear();
        self.listeners.clear();
        self.timers.clear();
        self.last_spawned_wake = None;
        // Re-seed the root mapping (apply_frame does this too, but the first
        // tick below needs it).
        let root_slot = (Self::ROOT_SOLID_ID & 0xFFFFF) as usize;
        let root_generation = (Self::ROOT_SOLID_ID >> 20) as u16;
        if self.id_map.len() <= root_slot {
            self.id_map.resize(root_slot + 1, None);
        }
        self.id_map[root_slot] = Some(GenerationNode { generation: root_generation, blitz_id: self.root_blitz_id });
        self.blitz_to_solid
            .insert(self.root_blitz_id, Self::ROOT_SOLID_ID);

        // Apply the new app's initial render immediately.
        self.tick_once();
    }

    /// Set the channel the bundle watcher uses to signal a reload. Called once
    /// after construction in window mode (see main.rs).
    pub fn set_reload_channel(&mut self, rx: mpsc::Receiver<ReloadMsg>) {
        self.reload_rx = Some(rx);
    }

    /// The Solid-side id we hand to JS as the mount root.
    pub const ROOT_SOLID_ID: u32 = 1;

    pub fn root_solid_id(&self) -> u32 {
        Self::ROOT_SOLID_ID
    }

    /// Look up the blitz node id for a Solid virtual id.
    pub fn get(&self, solid_id: u32) -> Option<usize> {
        let slot = (solid_id & 0xFFFFF) as usize;
        let generation = (solid_id >> 20) as u16;
        if let Some(Some(node)) = self.id_map.get(slot) {
            if node.generation == generation {
                return Some(node.blitz_id);
            }
        }
        None
    }

    /// Apply a full decoded frame.
    pub fn apply_frame(&mut self, frame: &Frame<'_>) {
        // Seed the root mapping if not present.
        let root_slot = (Self::ROOT_SOLID_ID & 0xFFFFF) as usize;
        let root_generation = (Self::ROOT_SOLID_ID >> 20) as u16;
        if self.id_map.len() <= root_slot {
            self.id_map.resize(root_slot + 1, None);
        }
        if self.id_map[root_slot].is_none() {
            self.id_map[root_slot] = Some(GenerationNode { generation: root_generation, blitz_id: self.root_blitz_id });
            self.blitz_to_solid.insert(self.root_blitz_id, Self::ROOT_SOLID_ID);
        }

        let mut mutr = self.doc.mutate();
        for op in &frame.ops {
            Self::apply_op(
                &mut mutr,
                &mut self.id_map,
                &mut self.blitz_to_solid,
                &mut self.listeners,
                op,
            );
        }
        // mutator flushes on drop
    }

    fn apply_op(
        mutr: &mut DocumentMutator<'_>,
        id_map: &mut Vec<Option<GenerationNode>>,
        blitz_to_solid: &mut HashMap<usize, u32>,
        listeners: &mut HashMap<u32, HashSet<u8>>,
        op: &Op<'_>,
    ) {
        let get = |id_map: &Vec<Option<GenerationNode>>, id: u32| -> Option<usize> {
            let slot = (id & 0xFFFFF) as usize;
            let generation = (id >> 20) as u16;
            if let Some(Some(node)) = id_map.get(slot) {
                if node.generation == generation {
                    return Some(node.blitz_id);
                }
            }
            None
        };
        let insert = |id_map: &mut Vec<Option<GenerationNode>>, id: u32, blitz_id: usize| {
            let slot = (id & 0xFFFFF) as usize;
            let generation = (id >> 20) as u16;
            if id_map.len() <= slot {
                id_map.resize(slot + 1, None);
            }
            id_map[slot] = Some(GenerationNode { generation, blitz_id });
        };
        match op {
            Op::CreateElement { id, tag, attrs } => {
                let qname = qual(tag);
                let attrs: Vec<Attribute> = attrs
                    .iter()
                    .map(|(n, v)| Attribute {
                        name: qual(n),
                        value: v.to_string(),
                    })
                    .collect();
                let blitz_id = mutr.create_element(qname, attrs);
                insert(id_map, *id, blitz_id);
                blitz_to_solid.insert(blitz_id, *id);
            }
            Op::CreateText { id, text } => {
                let blitz_id = mutr.create_text_node(text);
                insert(id_map, *id, blitz_id);
                blitz_to_solid.insert(blitz_id, *id);
            }
            Op::CreateComment { id, .. } => {
                let blitz_id = mutr.create_comment_node();
                insert(id_map, *id, blitz_id);
                blitz_to_solid.insert(blitz_id, *id);
            }
            Op::AppendChild { parent, child } => {
                let (p, c) = match (get(id_map, *parent), get(id_map, *child)) {
                    (Some(p), Some(c)) => (p, c),
                    _ => return,
                };
                mutr.append_children(p, &[c]);
            }
            Op::InsertBefore {
                parent,
                child,
                ref_id,
            } => {
                let (p, c) = match (get(id_map, *parent), get(id_map, *child)) {
                    (Some(p), Some(c)) => (p, c),
                    _ => return,
                };
                if *ref_id == 0 {
                    mutr.append_children(p, &[c]);
                } else if let Some(r) = get(id_map, *ref_id) {
                    mutr.insert_nodes_before(r, &[c]);
                } else {
                    mutr.append_children(p, &[c]);
                }
            }
            Op::RemoveChild { child, .. } => {
                if let Some(c) = get(id_map, *child) {
                    mutr.remove_node(c);
                }
            }
            Op::ReplaceNode { old_id, new_id, .. } => {
                if let (Some(old), Some(new)) = (get(id_map, *old_id), get(id_map, *new_id)) {
                    mutr.replace_node_with(old, &[new]);
                }
            }
            Op::SetText { id, text } => {
                if let Some(n) = get(id_map, *id) {
                    mutr.set_node_text(n, text);
                }
            }
            Op::SetAttribute { id, name, value } => {
                if let Some(n) = get(id_map, *id) {
                    if *name == "class" || *name == "className" {
                        mutr.set_attribute(n, qual("class"), value);
                    } else {
                        mutr.set_attribute(n, qual(name), value);
                    }
                }
            }
            Op::RemoveAttribute { id, name } => {
                if let Some(n) = get(id_map, *id) {
                    let nm = if *name == "className" {
                        "class"
                    } else {
                        name.as_ref()
                    };
                    mutr.clear_attribute(n, qual(nm));
                }
            }
            Op::SetStyle { id, prop, value } => {
                if let Some(n) = get(id_map, *id) {
                    mutr.set_style_property(n, prop, value);
                }
            }
            Op::RemoveStyle { id, prop } => {
                if let Some(n) = get(id_map, *id) {
                    mutr.remove_style_property(n, prop);
                }
            }
            Op::AddEventListener { id, event_type } => {
                listeners.entry(*id).or_default().insert(*event_type);
            }
            Op::RemoveEventListener { id, event_type } => {
                if let Some(s) = listeners.get_mut(id) {
                    s.remove(event_type);
                }
            }
            Op::SetClassName { id, value } => {
                if let Some(n) = get(id_map, *id) {
                    mutr.set_attribute(n, qual("class"), value);
                }
            }
            Op::DropNode { id } => {
                let slot = (*id & 0xFFFFF) as usize;
                let generation = (*id >> 20) as u16;
                if let Some(Some(node)) = id_map.get(slot) {
                    if node.generation == generation {
                        mutr.remove_node(node.blitz_id);
                        blitz_to_solid.remove(&node.blitz_id);
                        id_map[slot] = None;
                    }
                }
                listeners.remove(id);
            }
            Op::FrameEnd => {}
        }
    }

    /// Convenience: print the current document tree (debug).
    pub fn print_tree(&self) {
        self.doc.print_tree();
    }

    /// First node with the given tag name (depth-first from root), for probes.
    pub fn find_first_tag(&self, tag: &str) -> Option<usize> {
        fn walk(doc: &BaseDocument, id: usize, tag: &str) -> Option<usize> {
            let node = doc.get_node(id)?;
            if node
                .element_data()
                .is_some_and(|e| e.name.local.as_ref() == tag)
            {
                return Some(id);
            }
            for &child in &node.children {
                if let Some(found) = walk(doc, child, tag) {
                    return Some(found);
                }
            }
            None
        }
        walk(&self.doc, self.doc.root_node().id, tag)
    }

    /// Borrow the underlying document (for layout/resolve by the renderer).
    pub fn document(&self) -> &BaseDocument {
        &self.doc
    }

    pub fn document_mut(&mut self) -> &mut BaseDocument {
        &mut self.doc
    }

    pub fn reload_css(&mut self, new_css: &str) {
        if let Some(style_id) = self.find_first_tag("style") {
            let child_id = {
                if let Some(node) = self.doc.get_node(style_id) {
                    node.children.first().copied()
                } else {
                    None
                }
            };
            let mut mutr = self.doc.mutate();
            if let Some(text_node_id) = child_id {
                mutr.set_node_text(text_node_id, new_css);
            } else {
                let text_node_id = mutr.create_text_node(new_css);
                mutr.append_children(style_id, &[text_node_id]);
            }
            tracing::info!("CSS styles reloaded");
        } else {
            tracing::warn!("style tag not found in document head");
        }
    }
}

impl BlitzDocument for Applier {
    fn inner(&self) -> DocGuard<'_> {
        self.doc.inner()
    }
    fn inner_mut(&mut self) -> DocGuardMut<'_> {
        self.doc.inner_mut()
    }

    fn poll(&mut self, _task_context: Option<std::task::Context<'_>>) -> bool {
        // Store waker to schedule event loop wakeups for timers.
        if let Some(ctx) = _task_context {
            self.waker = Some(ctx.waker().clone());
            self.fetch.set_waker(&ctx.waker());
        }
        self.last_spawned_wake = None;

        // Drain completed fetches into JS
        let completions = self.fetch.drain();
        if !completions.is_empty() {
            self.js.resolve_fetches(completions);
        }

        // Hot-reload: if the bundle watcher signalled a change, rebuild the
        // JS runtime or update styles before this tick.
        let mut reload_js = false;
        let mut reload_css = false;
        if let Some(rx) = &self.reload_rx {
            while let Ok(msg) = rx.try_recv() {
                match msg {
                    ReloadMsg::Js => reload_js = true,
                    ReloadMsg::Css => reload_css = true,
                }
            }
        }
        if reload_js {
            tracing::info!("bundle.js changed — rebuilding JS runtime");
            self.reload_js();
        }
        if reload_css {
            tracing::info!("bundle.css changed — reloading styles");
            if let Ok(new_css) = std::fs::read_to_string(
                std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/gen/bundle.css"),
            ) {
                self.reload_css(&new_css);
            }
        }

        // Process any timer commands from JS.
        let cmds = self.js.take_timer_cmds();
        for cmd in cmds {
            match cmd {
                TimerCmd::Register {
                    id,
                    delay_ms,
                    repeat,
                } => {
                    let expires_at =
                        std::time::Instant::now() + std::time::Duration::from_millis(delay_ms);
                    self.timers.retain(|t| t.id != id);
                    self.timers.push(ActiveTimer {
                        id,
                        expires_at,
                        delay_ms,
                        repeat,
                    });
                }
                TimerCmd::Unregister { id } => {
                    self.timers.retain(|t| t.id != id);
                }
            }
        }

        // Check for expired timers and trigger their JS callbacks.
        let now = std::time::Instant::now();
        let mut to_trigger = Vec::new();
        for timer in &mut self.timers {
            if now >= timer.expires_at {
                to_trigger.push(timer.id);
                if timer.repeat {
                    timer.expires_at = now + std::time::Duration::from_millis(timer.delay_ms);
                }
            }
        }
        self.timers
            .retain(|t| !to_trigger.contains(&t.id) || t.repeat);

        for id in to_trigger {
            if let Err(e) = self.js.trigger_timer(id) {
                tracing::error!(timer_id = id, error = ?e, "failed to trigger timer");
            }
        }

        // One JS round-trip: __tick drains rAF, flushes ops, and reports
        // whether more rAF callbacks remain queued. A failed tick or malformed
        // frame is logged and skipped rather than panicking.
        let (bytes, has_raf) = match self.js.tick() {
            Ok(v) => v,
            Err(e) => {
                tracing::error!(target: "bridge", "JS tick failed: {e:?}");
                return false;
            }
        };
        if !bytes.is_empty() {
            match crate::protocol::decode_frame(&bytes) {
                Ok(frame) => self.apply_frame(&frame),
                Err(e) => tracing::error!(target: "bridge", "decode frame failed: {e}"),
            }
        }

        // If we are not actively animating but have pending timers, schedule a wake-up thread.
        let has_pending_timers = !self.timers.is_empty();
        if !has_raf && has_pending_timers {
            let earliest = self.timers.iter().map(|t| t.expires_at).min().unwrap();
            let should_spawn = match self.last_spawned_wake {
                Some(inst) => earliest < inst,
                None => true,
            };
            if should_spawn {
                self.last_spawned_wake = Some(earliest);
                let duration = earliest.saturating_duration_since(std::time::Instant::now());
                if let Some(waker) = &self.waker {
                    let waker = waker.clone();
                    std::thread::spawn(move || {
                        std::thread::sleep(duration);
                        waker.wake();
                    });
                }
            }
        }

        if has_raf {
            tracing::info!("poll returning true (has_raf=true)");
        }
        has_raf
    }

    /// Event return path: map a blitz UiEvent to a (event_code, json_payload)
    /// and dispatch it into the JS side. Pointer/wheel events hit-test the
    /// document to find a target; the JS side owns bubbling + stopPropagation
    /// along the Solid Handle tree. After dispatch we flush the frame so the
    /// next redraw reflects any signal updates.
    fn handle_ui_event(&mut self, event: UiEvent) {
        // Resolve (event_code, payload, optional hit coords) from the UiEvent.
        // coords present => pointer/wheel, needs hit-test for a target.
        let (code, payload, hit_xy): (u8, String, Option<(f32, f32)>) = match &event {
            UiEvent::PointerUp(e) => (
                event::POINTERUP,
                pointer_payload(e, /*clicked*/ true),
                Some((e.coords.client_x, e.coords.client_y)),
            ),
            UiEvent::PointerDown(e) => (
                event::POINTERDOWN,
                pointer_payload(e, false),
                Some((e.coords.client_x, e.coords.client_y)),
            ),
            UiEvent::PointerMove(e) => (
                event::POINTERMOVE,
                pointer_payload(e, false),
                Some((e.coords.client_x, e.coords.client_y)),
            ),
            UiEvent::Wheel(e) => {
                let (dx, dy) = match &e.delta {
                    BlitzWheelDelta::Lines(x, y) => (*x, *y),
                    BlitzWheelDelta::Pixels(x, y) => (*x, *y),
                };
                (
                    event::WHEEL,
                    format!(
                        r#"{{"clientX":{:.0},"clientY":{:.0},"deltaX":{:.0},"deltaY":{:.0}}}"#,
                        e.coords.client_x, e.coords.client_y, dx, dy
                    ),
                    Some((e.coords.client_x, e.coords.client_y)),
                )
            }
            UiEvent::KeyDown(e) => (event::KEYDOWN, key_payload(e), None),
            UiEvent::KeyUp(e) => (event::KEYUP, key_payload(e), None),
            // IME / Apple keybindings: not wired to JS yet.
            UiEvent::Ime(_) | UiEvent::AppleStandardKeybinding(_) => return,
        };

        // Find the target Solid id: hit-test (for pointer/wheel) then walk up
        // the blitz DOM to the nearest node in our id map (blitz may insert
        // anonymous wrapper nodes that aren't mapped). Key events have no
        // target — dispatch to the root so window-level listeners fire.
        let target_sid = if let Some((x, y)) = hit_xy {
            let hit = self.doc.hit(x, y);
            let mut cur = hit.as_ref().map(|h| h.node_id);
            let mut found = None;
            while let Some(bid) = cur {
                if let Some(&sid) = self.blitz_to_solid.get(&bid) {
                    found = Some(sid);
                    break;
                }
                cur = self.doc.get_node(bid).and_then(|n| n.parent);
            }
            found
        } else {
            Some(Self::ROOT_SOLID_ID)
        };

        if let Some(sid) = target_sid {
            let _ = self.js.dispatch_event(sid, code, &payload);
            self.tick_once();
        }
    }
}

/// Build a JSON payload for a pointer event: client coords + button + pressed
/// buttons + modifier flags. `clicked` is true for pointerup (a click also
/// fires — the JS side synthesizes `click` from pointerup).
fn pointer_payload(e: &BlitzPointerEvent, _clicked: bool) -> String {
    format!(
        r#"{{"clientX":{:.0},"clientY":{:.0},"button":{},"buttons":{},"mods":{}}}"#,
        e.coords.client_x,
        e.coords.client_y,
        e.button as u8,
        e.buttons.bits(),
        e.mods.bits(),
    )
}

/// Build a JSON payload for a key event: key (Display), code (Display), mods.
fn key_payload(e: &BlitzKeyEvent) -> String {
    format!(
        r#"{{"key":{},"code":"{}","mods":{}}}"#,
        json_string(&e.key.to_string()),
        e.code,
        e.modifiers.bits(),
    )
}

/// Minimal JSON string escape (no external serde dependency).
fn json_string(s: &str) -> String {
    let mut out = String::from("\"");
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_timers() {
        let mut applier = Applier::new(Box::new(|_| {}));

        // Verify that TextEncoder is correctly polyfilled and uses the Rust host encoder
        applier.js.context().with(|ctx| {
            let res: String = ctx
                .eval("new TextEncoder().encode('hello').join(',')")
                .unwrap();
            assert_eq!(res, "104,101,108,108,111");
        });

        // Register a timeout of 50ms and an interval of 20ms
        applier.js.context().with(|ctx| {
            ctx.eval::<(), _>(
                r#"
                globalThis.triggerCount = 0;
                globalThis.testTimeoutId = setTimeout(() => {
                    __host_log("Timeout fired!");
                    triggerCount++;
                }, 50);

                globalThis.testIntervalCount = 0;
                globalThis.testIntervalId = setInterval(() => {
                    testIntervalCount++;
                    __host_log(`Interval fired: ${testIntervalCount}`);
                }, 20);
            "#,
            )
            .expect("eval");
        });

        // Initially no timers have expired
        applier.poll(None);
        applier.js.context().with(|ctx| {
            let tc: i32 = ctx.globals().get("triggerCount").unwrap();
            let ic: i32 = ctx.globals().get("testIntervalCount").unwrap();
            assert_eq!(tc, 0);
            assert_eq!(ic, 0);
        });

        // Wait 30ms, interval should fire once, timeout should not fire
        std::thread::sleep(std::time::Duration::from_millis(30));
        applier.poll(None);
        applier.js.context().with(|ctx| {
            let tc: i32 = ctx.globals().get("triggerCount").unwrap();
            let ic: i32 = ctx.globals().get("testIntervalCount").unwrap();
            assert_eq!(tc, 0);
            assert_eq!(ic, 1);
        });

        // Wait another 30ms (total 60ms), timeout should fire once, interval should fire again
        std::thread::sleep(std::time::Duration::from_millis(30));
        applier.poll(None);
        applier.js.context().with(|ctx| {
            let tc: i32 = ctx.globals().get("triggerCount").unwrap();
            let ic: i32 = ctx.globals().get("testIntervalCount").unwrap();
            assert_eq!(tc, 1);
            assert_eq!(ic, 2);
        });

        // Clear the interval
        applier.js.context().with(|ctx| {
            ctx.eval::<(), _>(
                r#"
                clearInterval(testIntervalId);
            "#,
            )
            .expect("clear");
        });

        // Wait 30ms, interval should not increment anymore
        std::thread::sleep(std::time::Duration::from_millis(30));
        applier.poll(None);
        applier.js.context().with(|ctx| {
            let ic: i32 = ctx.globals().get("testIntervalCount").unwrap();
            assert_eq!(ic, 2);
        });
    }
}
