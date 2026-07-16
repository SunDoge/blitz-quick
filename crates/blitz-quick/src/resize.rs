//! Bridge for the JS `ResizeObserver` polyfill.
//!
//! JS registers interest in a Solid handle's size via the `__resize_observe`
//! host function; the Applier measures the corresponding blitz node after each
//! resolve and, when its content-box size changes, pushes a `ResizeChange`
//! here. The JS runtime drains these and invokes the matching observer
//! callback.
//!
//! This mirrors the FetchBridge shape (shared state + drain on the JS thread)
//! but is entirely synchronous — no tokio, no worker threads. Measurement
//! happens in `Applier::poll` after layout, which already runs on the main
//! thread.

use std::sync::{Arc, Mutex};

/// A size change to deliver to a JS observer callback.
#[derive(Debug, Clone, Copy)]
pub struct ResizeChange {
    /// The Solid handle id the JS side passed to `observe()`.
    pub solid_id: u32,
    /// New content-box width in CSS pixels.
    pub width: f32,
    /// New content-box height in CSS pixels.
    pub height: f32,
}

/// Per-target observer state held on the Rust side. `last` is the last size we
/// reported (or None on first measure), so we only push a change when it
/// actually differs.
#[derive(Debug, Clone, Copy, Default)]
pub struct Observed {
    last: Option<(f32, f32)>,
}

/// Shared between the JsRuntime (host fn closures) and the Applier (measurer).
#[derive(Default)]
pub struct ResizeBridge {
    /// Solid id -> observer state. Written by host fns, read by the Applier.
    targets: Arc<Mutex<std::collections::HashMap<u32, Observed>>>,
    /// Size changes queued by the Applier, drained by the JsRuntime.
    changes: Arc<Mutex<Vec<ResizeChange>>>,
}

impl ResizeBridge {
    pub fn new() -> Self {
        Self::default()
    }

    /// Expose the shared target map so host fn closures can mutate it without
    /// owning the bridge (the JsRuntime outlives individual host fn calls and
    /// needs a cheap clone).
    pub fn targets_handle(&self) -> Arc<Mutex<std::collections::HashMap<u32, Observed>>> {
        self.targets.clone()
    }

    /// Expose the shared change queue for the same reason.
    pub fn changes_handle(&self) -> Arc<Mutex<Vec<ResizeChange>>> {
        self.changes.clone()
    }

    /// Called by the Applier after resolve: for every observed target, look up
    /// its blitz node's content-box size and, if changed, record a
    /// [`ResizeChange`] and update the last-seen size.
    ///
    /// `resolve` maps a Solid id to a blitz node id (the Applier's id_map).
    /// `size` maps a blitz node id to its content-box (width, height) in CSS
    /// pixels — passed as a closure so this module stays decoupled from
    /// blitz-dom and the Applier's internals.
    pub fn measure(
        &self,
        resolve: impl Fn(u32) -> Option<usize>,
        size: impl Fn(usize) -> Option<(f32, f32)>,
    ) {
        let mut targets = self.targets.lock().unwrap();
        if targets.is_empty() {
            return;
        }
        let mut changes = Vec::new();
        for (solid_id, obs) in targets.iter_mut() {
            let Some(blitz_id) = resolve(*solid_id) else {
                continue;
            };
            let Some((w, h)) = size(blitz_id) else {
                continue;
            };
            if obs.last != Some((w, h)) {
                obs.last = Some((w, h));
                changes.push(ResizeChange {
                    solid_id: *solid_id,
                    width: w,
                    height: h,
                });
            }
        }
        drop(targets);
        if !changes.is_empty() {
            self.changes.lock().unwrap().extend(changes);
        }
    }

    /// Drain pending changes. Called on the JS thread each tick.
    pub fn drain(&self) -> Vec<ResizeChange> {
        std::mem::take(&mut *self.changes.lock().unwrap())
    }
}
