//! Apply decoded protocol ops to a blitz-dom document.
//!
//! The applier owns the `BaseDocument` and a mapping from Solid-side virtual
//! node ids (`u32`) to blitz slab node ids (`usize`). Each frame is decoded by
//! `protocol::decode_frame` and applied in order.

use std::collections::{HashMap, HashSet};
use std::sync::mpsc;

use blitz_dom::{
    Attribute, BaseDocument, DEFAULT_CSS, DocGuard, DocGuardMut, Document as BlitzDocument,
    DocumentConfig, LocalName, QualName, ns,
};
use blitz_traits::events::UiEvent;
use blitz_traits::shell::{ColorScheme, Viewport};
use snafu::{Snafu, ensure};

use crate::jsrt::{JsRuntime, TimerCmd};
use crate::protocol::Frame;

pub struct AppConfig {
    javascript: String,
    vite: Option<ViteSource>,
    stylesheet: String,
    width: u32,
    height: u32,
    scale: f64,
    net_provider: Option<std::sync::Arc<dyn blitz_traits::net::NetProvider>>,
}

struct ViteSource {
    server_url: String,
    entry: String,
}

impl AppConfig {
    pub fn new(javascript: impl Into<String>) -> Self {
        Self {
            javascript: javascript.into(),
            vite: None,
            stylesheet: String::new(),
            width: 800,
            height: 600,
            scale: 1.0,
            net_provider: None,
        }
    }

    pub fn vite(server_url: impl Into<String>, entry: impl Into<String>) -> Self {
        Self {
            javascript: String::new(),
            vite: Some(ViteSource {
                server_url: server_url.into(),
                entry: entry.into(),
            }),
            stylesheet: String::new(),
            width: 800,
            height: 600,
            scale: 1.0,
            net_provider: None,
        }
    }

    pub fn with_stylesheet(mut self, stylesheet: impl Into<String>) -> Self {
        self.stylesheet = stylesheet.into();
        self
    }

    pub fn with_viewport(mut self, width: u32, height: u32) -> Self {
        self.width = width;
        self.height = height;
        self
    }

    pub fn with_scale(mut self, scale: f64) -> Self {
        self.scale = scale;
        self
    }

    /// Inject a network provider for remote resource loading (images,
    /// stylesheets, fonts via `<img src>`, `<link>`, `@font-face`). Without
    /// this, blitz-dom uses a dummy provider that loads nothing. The embedding
    /// app owns the provider — e.g. desktop creates `blitz_net::Provider`.
    pub fn with_net_provider(
        mut self,
        provider: std::sync::Arc<dyn blitz_traits::net::NetProvider>,
    ) -> Self {
        self.net_provider = Some(provider);
        self
    }

    pub fn width(&self) -> u32 {
        self.width
    }

    pub fn height(&self) -> u32 {
        self.height
    }

    pub fn scale(&self) -> f64 {
        self.scale
    }

    fn validate(&self) -> Result<(), ApplierError> {
        ensure!(
            self.vite.is_some() || !self.javascript.trim().is_empty(),
            InvalidConfigSnafu {
                message: "javascript cannot be empty"
            }
        );
        if let Some(vite) = &self.vite {
            ensure!(
                url::Url::parse(&vite.server_url).is_ok(),
                InvalidConfigSnafu {
                    message: "Vite server URL must be absolute"
                }
            );
            ensure!(
                !vite.entry.trim().is_empty(),
                InvalidConfigSnafu {
                    message: "Vite entry cannot be empty"
                }
            );
        }
        ensure!(
            self.width > 0 && self.height > 0,
            InvalidConfigSnafu {
                message: "viewport dimensions must be non-zero"
            }
        );
        ensure!(
            self.scale.is_finite() && self.scale > 0.0,
            InvalidConfigSnafu {
                message: "render scale must be finite and positive"
            }
        );
        Ok(())
    }
}

#[derive(Debug, Snafu)]
pub enum ApplierError {
    #[snafu(display("invalid app configuration: {message}"))]
    InvalidConfig { message: &'static str },
    #[snafu(display("QuickJS error: {source}"), context(false))]
    QuickJs { source: rquickjs::Error },
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct GenerationNode {
    pub generation: u16,
    pub blitz_id: usize,
}

/// An `Applier` is a blitz `Document` that drives a Solid app on QuickJS.
/// On each `poll()` it runs one rAF tick (JS → binary frame → apply ops to the
/// underlying `BaseDocument`) and returns true while rAF callbacks remain
/// queued, so blitz-shell keeps redrawing at vsync.
pub struct Applier {
    doc: BaseDocument,
    /// The QuickJS runtime running the bundled Solid app. None only briefly
    /// during construction (before boot).
    js: JsRuntime,
    /// Solid virtual id (slot) -> blitz node id + generation.
    id_map: Vec<Option<GenerationNode>>,
    /// Inverse: blitz node id -> full Solid virtual id (for event return path).
    blitz_to_solid: HashMap<usize, u32>,
    /// root mount node (blitz id) — Solid top-level appends here.
    root_blitz_id: usize,
    /// Tracked event listeners (solidId -> set of event type bytes), for the
    /// event return path (see DESIGN.md §6).
    listeners: HashMap<u32, HashSet<u8>>,
    /// Receives Vite HMR signals and is drained on the main thread.
    reload_rx: Option<mpsc::Receiver<ReloadMsg>>,
    reload_waker: std::sync::Arc<std::sync::Mutex<Option<std::task::Waker>>>,
    timers: Vec<ActiveTimer>,
    waker: Option<std::task::Waker>,
    last_spawned_wake: Option<std::time::Instant>,
    /// ResizeObserver bridge: JS registers targets, Applier measures them
    /// after resolve and the JS runtime drains changes. Shared (Arc) so the
    /// host fn closures in jsrt can mutate the target map.
    resize: std::sync::Arc<crate::resize::ResizeBridge>,
    /// The blitz node id that most recently received a PointerDown event.
    focused_blitz_id: Option<usize>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReloadMsg {
    Css(String),
    HmrUpdate {
        path: String,
        accepted_path: String,
        timestamp: u64,
        source: String,
    },
    FullReload,
}

#[derive(Clone)]
pub struct ReloadHandle {
    tx: mpsc::Sender<ReloadMsg>,
    waker: std::sync::Arc<std::sync::Mutex<Option<std::task::Waker>>>,
}

impl ReloadHandle {
    pub fn send(&self, message: ReloadMsg) -> Result<(), mpsc::SendError<ReloadMsg>> {
        self.tx.send(message)?;
        if let Ok(waker) = self.waker.lock()
            && let Some(waker) = waker.as_ref()
        {
            waker.wake_by_ref();
        }
        Ok(())
    }
}

struct ActiveTimer {
    id: u32,
    expires_at: std::time::Instant,
    delay_ms: u64,
    repeat: bool,
}

impl Applier {
    /// Build a minimal HTML document with #root, then load DEFAULT_CSS as the
    /// UA stylesheet. The app's own stylesheet
    /// (UnoCSS) is NOT loaded here — the JS side renders it into a <style>
    /// node (blitz-dom parses <style> textContent as an author stylesheet on
    /// flush), so CSS rides along the normal DOM ops and is hot-reloadable
    /// from JS without touching Rust. The explicit html>head+body structure is
    /// required for Stylo to produce non-zero layout.
    pub fn new(
        config: AppConfig,
        on_runtime_init: impl Fn(&JsRuntime) -> rquickjs::Result<()> + 'static,
    ) -> Result<Self, ApplierError> {
        config.validate()?;
        let document_config = DocumentConfig {
            ua_stylesheets: Some(vec![DEFAULT_CSS.to_string()]),
            viewport: Some(Viewport::new(
                (config.width as f64 * config.scale) as u32,
                (config.height as f64 * config.scale) as u32,
                config.scale as f32,
                ColorScheme::Light,
            )),
            net_provider: config.net_provider.clone(),
            ..DocumentConfig::default()
        };
        let mut doc = BaseDocument::new(document_config);
        let document_id = doc.root_node().id;
        let root_blitz_id = {
            let mut mutr = doc.mutate();
            let element_name = |name: &str| QualName::new(None, ns!(html), LocalName::from(name));

            let html_id = mutr.create_element(element_name("html"), vec![]);
            let head_id = mutr.create_element(element_name("head"), vec![]);
            let style_id = mutr.create_element(element_name("style"), vec![]);
            let style_text_id = mutr.create_text_node(&config.stylesheet);
            let body_id = mutr.create_element(element_name("body"), vec![]);
            let root_id = mutr.create_element(
                element_name("div"),
                vec![Attribute {
                    name: element_name("id"),
                    value: "root".to_string(),
                }],
            );

            mutr.append_children(style_id, &[style_text_id]);
            mutr.append_children(head_id, &[style_id]);
            mutr.append_children(body_id, &[root_id]);
            mutr.append_children(html_id, &[head_id, body_id]);
            mutr.append_children(document_id, &[html_id]);
            root_id
        };
        let js = if let Some(vite) = &config.vite {
            JsRuntime::new_vite(&vite.server_url)?
        } else {
            JsRuntime::new()?
        };
        let resize = std::sync::Arc::new(crate::resize::ResizeBridge::new());
        js.register_resize(&resize)?;

        // Let the user register their FFI methods
        on_runtime_init(&js)?;

        let mut applier = Applier {
            doc,
            js,
            id_map: Vec::new(),
            blitz_to_solid: HashMap::new(),
            root_blitz_id,
            listeners: HashMap::new(),
            reload_rx: None,
            reload_waker: std::sync::Arc::new(std::sync::Mutex::new(None)),
            timers: Vec::new(),
            waker: None,
            last_spawned_wake: None,
            resize,
            focused_blitz_id: None,
        };
        if let Some(vite) = &config.vite {
            applier.js.boot_vite(&vite.server_url, &vite.entry)?;
        } else {
            applier.js.boot(&config.javascript)?;
        }
        Ok(applier)
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

    pub fn reload_handle(&mut self) -> ReloadHandle {
        let (tx, rx) = mpsc::channel();
        self.reload_rx = Some(rx);
        ReloadHandle {
            tx,
            waker: self.reload_waker.clone(),
        }
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
        if let Some(Some(node)) = self.id_map.get(slot)
            && node.generation == generation
        {
            return Some(node.blitz_id);
        }
        None
    }

    /// Apply a full decoded frame.
    fn apply_frame(&mut self, frame: &Frame<'_>) {
        // Seed the root mapping if not present.
        let root_slot = (Self::ROOT_SOLID_ID & 0xFFFFF) as usize;
        let root_generation = (Self::ROOT_SOLID_ID >> 20) as u16;
        if self.id_map.len() <= root_slot {
            self.id_map.resize(root_slot + 1, None);
        }
        if self.id_map[root_slot].is_none() {
            self.id_map[root_slot] = Some(GenerationNode {
                generation: root_generation,
                blitz_id: self.root_blitz_id,
            });
            self.blitz_to_solid
                .insert(self.root_blitz_id, Self::ROOT_SOLID_ID);
        }

        let mut mutr = self.doc.mutate();
        for op in &frame.ops {
            crate::dom_updater::apply_op(
                &mut mutr,
                &mut self.id_map,
                &mut self.blitz_to_solid,
                &mut self.listeners,
                op,
            );
        }
        // mutator flushes on drop
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

    /// Resolve a blitz node id to the Solid virtual id that owns it. Walks up
    /// the blitz DOM because blitz may insert anonymous wrapper nodes (e.g.
    /// anonymous block boxes) that aren't in our id map. Returns None if no
    /// mapped ancestor exists.
    fn solid_id_for(&self, mut blitz_id: usize) -> Option<u32> {
        loop {
            if let Some(&sid) = self.blitz_to_solid.get(&blitz_id) {
                return Some(sid);
            }
            blitz_id = self.doc.get_node(blitz_id)?.parent?;
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

    fn poll(&mut self, mut task_context: Option<std::task::Context<'_>>) -> bool {
        let mut needs_redraw = false;
        // Enable IME if the shell provider has been attached.
        self.doc.inner().shell_provider.set_ime_enabled(true);

        // Store waker to schedule event loop wakeups for timers.
        if let Some(ctx) = task_context.as_ref() {
            self.waker = Some(ctx.waker().clone());
            if let Ok(mut reload_waker) = self.reload_waker.lock() {
                *reload_waker = Some(ctx.waker().clone());
            }
        }

        if let Some(ctx) = task_context.as_mut() {
            match self.js.poll_pending_jobs(ctx) {
                Ok(true) => needs_redraw = true,
                Ok(false) => {}
                Err(error) => tracing::error!(?error, "failed to poll QuickJS jobs"),
            }
        }
        let now = std::time::Instant::now();
        if self
            .last_spawned_wake
            .is_some_and(|deadline| now >= deadline)
        {
            self.last_spawned_wake = None;
        }

        // Measure ResizeObserver targets against the latest layout and
        // dispatch any size changes back into JS. Runs every poll so a freshly
        // observed element reports its initial size on the next frame, and
        // window/container resizes are picked up as they happen.
        {
            let this = &*self;
            this.resize.measure(
                |solid_id| this.get(solid_id),
                |blitz_id| {
                    this.doc.get_node(blitz_id).map(|n| {
                        (
                            n.final_layout.content_box_width(),
                            n.final_layout.content_box_height(),
                        )
                    })
                },
            );
        }
        if let Err(error) = self.js.drain_resize(&self.resize) {
            tracing::error!(?error, "failed to drain resize changes");
        }

        // Apply Vite HMR messages before the next application tick.
        let mut reload_css = None;
        let mut hmr_updates = Vec::new();
        let mut full_reload = false;
        if let Some(rx) = &self.reload_rx {
            while let Ok(msg) = rx.try_recv() {
                match msg {
                    ReloadMsg::Css(content) => reload_css = Some(content),
                    ReloadMsg::HmrUpdate {
                        path,
                        accepted_path,
                        timestamp,
                        source,
                    } => hmr_updates.push((path, accepted_path, timestamp, source)),
                    ReloadMsg::FullReload => full_reload = true,
                }
            }
        }
        if let Some(content) = reload_css {
            tracing::info!("applying Vite stylesheet update");
            self.reload_css(&content);
            needs_redraw = true;
        }
        for (path, accepted_path, timestamp, source) in hmr_updates {
            let started = std::time::Instant::now();
            match self
                .js
                .apply_hmr_update(&path, &accepted_path, timestamp, source)
            {
                Ok(true) => {
                    needs_redraw = true;
                    tracing::info!(%path, %accepted_path, elapsed = ?started.elapsed(), "applied Vite HMR update")
                }
                Ok(false) => {
                    tracing::warn!(%path, %accepted_path, "Vite HMR boundary requested full reload");
                }
                Err(error) => {
                    tracing::error!(?error, %path, %accepted_path, "failed to apply Vite HMR update");
                }
            }
        }
        if full_reload {
            tracing::warn!("Vite requested a full reload; restart the desktop host for now");
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
            needs_redraw = true;
            match crate::protocol::decode_frame(&bytes) {
                Ok(frame) => self.apply_frame(&frame),
                Err(e) => tracing::error!(target: "bridge", "decode frame failed: {e}"),
            }
        }

        // If we are not actively animating but have pending timers, schedule a wake-up thread.
        let has_pending_timers = !self.timers.is_empty();
        if !has_raf && has_pending_timers {
            let earliest = self.timers.iter().map(|t| t.expires_at).min().unwrap();
            let should_spawn = self
                .last_spawned_wake
                .is_none_or(|scheduled| earliest < scheduled);
            if should_spawn && let Some(waker) = &self.waker {
                self.last_spawned_wake = Some(earliest);
                let duration = earliest.saturating_duration_since(std::time::Instant::now());
                let waker = waker.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(duration);
                    waker.wake();
                });
            }
        } else if !has_pending_timers {
            self.last_spawned_wake = None;
        }

        if has_raf || needs_redraw {
            tracing::trace!(has_raf, needs_redraw, "poll requesting redraw");
        }
        has_raf || needs_redraw
    }

    /// Event return path: map a blitz UiEvent to a (event_code, json_payload)
    /// and dispatch it into the JS side. Pointer/wheel events hit-test the
    /// document to find a target; the JS side owns bubbling + stopPropagation
    /// along the Solid Handle tree. After dispatch we flush the frame so the
    /// next redraw reflects any signal updates.
    fn handle_ui_event(&mut self, event: UiEvent) {
        use blitz_traits::events::{DomEvent, EventState};

        // Single event path: let blitz-dom's EventDriver run native default
        // actions (scroll, focus, drag selection, etc.) and collect every
        // DOM event it dispatches — including synthesized click/enter/leave
        // and bubbling. We then translate each emitted DomEvent to the JS
        // wire format and forward it. There is no separate re-translation of
        // the raw UiEvent and no second hit-test: EventDriver already resolved
        // the target and bubble chain.
        let mut emitted_events = Vec::new();
        {
            struct Collector<'a>(&'a mut Vec<DomEvent>);
            impl<'a> blitz_dom::EventHandler for Collector<'a> {
                fn handle_event(
                    &mut self,
                    _chain: &[usize],
                    event: &mut DomEvent,
                    _doc: &mut dyn blitz_dom::Document,
                    _event_state: &mut EventState,
                ) {
                    self.0.push(event.clone());
                }
            }

            let mut driver =
                blitz_dom::EventDriver::new(&mut self.doc, Collector(&mut emitted_events));
            driver.handle_ui_event(event);
        }

        let mut dispatched = false;
        for dom_event in emitted_events {
            // Track focus for key-event targeting. EventDriver already routes
            // key events to the focused node, but we keep the last PointerDown
            // target so key events with no DOM-side focus still reach JS.
            if matches!(
                dom_event.data,
                blitz_traits::events::DomEventData::PointerDown(_)
            ) {
                self.focused_blitz_id = Some(dom_event.target);
            }

            let Some(sid) = self.solid_id_for(dom_event.target) else {
                continue;
            };
            let Some((code, num_data, payload)) = crate::events::translate_dom_event(&dom_event)
            else {
                // Not modeled on the JS side (legacy mouse*/touch*, macOS
                // keybindings). Native processing already happened.
                continue;
            };
            let result = if let Some(data) = num_data {
                self.js.dispatch_shared_numeric_event(sid, code, data)
            } else {
                self.js.dispatch_event(sid, code, &payload)
            };
            if result.is_ok() {
                dispatched = true;
            }
        }

        // One tick after all events for this UiEvent are forwarded, so the JS
        // side processes the batch and flushes a single frame.
        if dispatched {
            self.tick_once();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_applier() -> Applier {
        Applier::new(AppConfig::new(crate::jsrt::TEST_RUNTIME), |_| Ok(())).expect("create applier")
    }

    #[test]
    fn reports_invalid_configuration_with_snafu() {
        let error = match Applier::new(AppConfig::new(""), |_| Ok(())) {
            Ok(_) => panic!("empty JavaScript should be rejected"),
            Err(error) => error,
        };

        assert!(matches!(
            &error,
            ApplierError::InvalidConfig {
                message: "javascript cannot be empty"
            }
        ));
        assert_eq!(
            error.to_string(),
            "invalid app configuration: javascript cannot be empty"
        );
    }

    #[test]
    fn reparents_and_reorders_existing_nodes() {
        let mut applier = test_applier();
        let mut initial = crate::protocol::Encoder::new(1);
        initial.create_element(2, "div", &[]);
        initial.create_element(3, "span", &[]);
        initial.create_element(4, "section", &[]);
        initial.create_element(5, "button", &[]);
        initial.append_child(Applier::ROOT_SOLID_ID, 2);
        initial.append_child(Applier::ROOT_SOLID_ID, 4);
        initial.append_child(2, 3);
        initial.append_child(2, 5);
        let bytes = initial.finish();
        let frame = crate::protocol::decode_frame(&bytes).expect("decode initial frame");
        applier.apply_frame(&frame);

        let parent_a = applier.get(2).expect("first parent");
        let child_a = applier.get(3).expect("first child");
        let parent_b = applier.get(4).expect("second parent");
        let child_b = applier.get(5).expect("second child");

        let mut reorder = crate::protocol::Encoder::new(2);
        reorder.insert_before(2, 5, 3);
        let bytes = reorder.finish();
        let frame = crate::protocol::decode_frame(&bytes).expect("decode reorder frame");
        applier.apply_frame(&frame);
        assert_eq!(
            applier.document().get_node(parent_a).unwrap().children,
            vec![child_b, child_a]
        );

        let mut reparent = crate::protocol::Encoder::new(3);
        reparent.append_child(4, 3);
        let bytes = reparent.finish();
        let frame = crate::protocol::decode_frame(&bytes).expect("decode reparent frame");
        applier.apply_frame(&frame);
        assert_eq!(
            applier.document().get_node(child_a).unwrap().parent,
            Some(parent_b)
        );
        assert_eq!(
            applier.document().get_node(parent_a).unwrap().children,
            vec![child_b]
        );
    }

    #[test]
    fn test_timers() {
        let mut applier = test_applier();

        // Verify that TextEncoder is correctly polyfilled and uses the Rust host encoder
        applier.js.with(|ctx| {
            let res: String = ctx
                .eval("new TextEncoder().encode('hello').join(',')")
                .unwrap();
            assert_eq!(res, "104,101,108,108,111");
        });

        // Register a timeout of 50ms and an interval of 20ms
        applier.js.with(|ctx| {
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
        applier.js.with(|ctx| {
            let tc: i32 = ctx.globals().get("triggerCount").unwrap();
            let ic: i32 = ctx.globals().get("testIntervalCount").unwrap();
            assert_eq!(tc, 0);
            assert_eq!(ic, 0);
        });

        // Wait 30ms, interval should fire once, timeout should not fire
        std::thread::sleep(std::time::Duration::from_millis(30));
        applier.poll(None);
        applier.js.with(|ctx| {
            let tc: i32 = ctx.globals().get("triggerCount").unwrap();
            let ic: i32 = ctx.globals().get("testIntervalCount").unwrap();
            assert_eq!(tc, 0);
            assert_eq!(ic, 1);
        });

        // Wait another 30ms (total 60ms), timeout should fire once, interval should fire again
        std::thread::sleep(std::time::Duration::from_millis(30));
        applier.poll(None);
        applier.js.with(|ctx| {
            let tc: i32 = ctx.globals().get("triggerCount").unwrap();
            let ic: i32 = ctx.globals().get("testIntervalCount").unwrap();
            assert_eq!(tc, 1);
            assert_eq!(ic, 2);
        });

        // Clear the interval
        applier.js.with(|ctx| {
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
        applier.js.with(|ctx| {
            let ic: i32 = ctx.globals().get("testIntervalCount").unwrap();
            assert_eq!(ic, 2);
        });
    }

    #[test]
    fn reuses_the_scheduled_timer_wake() {
        struct WakeCounter(std::sync::atomic::AtomicUsize);

        impl std::task::Wake for WakeCounter {
            fn wake(self: std::sync::Arc<Self>) {
                self.0.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            }
        }

        let mut applier = test_applier();
        applier.js.with(|ctx| {
            ctx.eval::<(), _>("setTimeout(() => {}, 100)")
                .expect("register timeout");
        });

        let wake_counter = std::sync::Arc::new(WakeCounter(std::sync::atomic::AtomicUsize::new(0)));
        let waker = std::task::Waker::from(wake_counter.clone());
        applier.poll(Some(std::task::Context::from_waker(&waker)));
        let first_deadline = applier.last_spawned_wake.expect("scheduled wake");
        for _ in 0..50 {
            applier.poll(Some(std::task::Context::from_waker(&waker)));
        }
        std::thread::sleep(std::time::Duration::from_millis(200));

        assert_eq!(applier.last_spawned_wake, Some(first_deadline));
        assert_eq!(wake_counter.0.load(std::sync::atomic::Ordering::Relaxed), 1);
    }

    #[test]
    fn hot_reload_wakes_the_shell_and_requests_redraw() {
        struct WakeCounter(std::sync::atomic::AtomicUsize);

        impl std::task::Wake for WakeCounter {
            fn wake(self: std::sync::Arc<Self>) {
                self.0.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            }

            fn wake_by_ref(self: &std::sync::Arc<Self>) {
                self.0.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            }
        }

        let mut applier = test_applier();
        let reload = applier.reload_handle();
        let wake_counter = std::sync::Arc::new(WakeCounter(std::sync::atomic::AtomicUsize::new(0)));
        let waker = std::task::Waker::from(wake_counter.clone());
        applier.poll(Some(std::task::Context::from_waker(&waker)));

        reload
            .send(ReloadMsg::Css("body { color: green; }".to_owned()))
            .expect("send stylesheet update");

        assert_eq!(wake_counter.0.load(std::sync::atomic::Ordering::Relaxed), 1);
        assert!(applier.poll(Some(std::task::Context::from_waker(&waker))));
    }
}
