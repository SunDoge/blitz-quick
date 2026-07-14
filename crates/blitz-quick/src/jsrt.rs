//! QuickJS host (via rquickjs).
//!
//! Owns the runtime + context, injects the host functions the JS side needs
//! (`__bridge_flush`, `__host_log`), loads `runtime.js` + `app.js`, and exposes
//! a `tick()` that runs the requestAnimationFrame queue for one frame and
//! returns the flushed binary frame bytes.

use std::cell::RefCell;
use std::rc::Rc;

use rquickjs::{Context, Function, Module, Runtime, TypedArray, Value};
type JsResult<T> = rquickjs::Result<T>;

#[cfg(test)]
pub(crate) const TEST_BUNDLE: &str = r#"
let nextTimerId = 1;
const timers = new Map();
globalThis.TextEncoder = class {
  encode(value) { return __host_utf8_encode(String(value)); }
};
globalThis.setTimeout = function (callback, delay) {
  const id = nextTimerId++;
  timers.set(id, { callback, repeat: false });
  __register_timer(id, delay, false);
  return id;
};
globalThis.setInterval = function (callback, delay) {
  const id = nextTimerId++;
  timers.set(id, { callback, repeat: true });
  __register_timer(id, delay, true);
  return id;
};
globalThis.clearTimeout = globalThis.clearInterval = function (id) {
  timers.delete(id);
  __unregister_timer(id);
};
globalThis.__triggerTimer = function (id) {
  const timer = timers.get(id);
  if (!timer) return;
  if (!timer.repeat) timers.delete(id);
  timer.callback();
};
let nextFetchId = 1;
globalThis.fetch = function (url, init) {
  return new Promise(function (resolve, reject) {
    __fetch_start(
      nextFetchId++, String(url), init?.method ?? "GET", "{}", null, resolve, reject
    );
  }).then(function (res) {
    if (res.error) throw new Error(res.error);
    return {
      status: res.status,
      text: function () { return Promise.resolve(res.body); }
    };
  });
};
let initialFramePending = true;
globalThis.__tick = function () {
  if (initialFramePending) {
    initialFramePending = false;
    __bridge_flush(new Uint8Array([0, 0, 0, 0, 0, 0]));
  }
  return false;
};
globalThis.__hasRaf = function () { return false; };
globalThis.__dispatchEvent = function () {};
"#;

#[derive(Debug, Clone, Copy)]
pub enum TimerCmd {
    Register {
        id: u32,
        delay_ms: u64,
        repeat: bool,
    },
    Unregister {
        id: u32,
    },
}

struct FetchPromise {
    resolve: rquickjs::Persistent<Function<'static>>,
}

pub struct JsRuntime {
    /// Bytes flushed by the most recent `__bridge_flush` call.
    out: Rc<RefCell<Vec<u8>>>,
    /// True once the app's initial render has been evaluated.
    booted: bool,
    timer_cmds: Rc<RefCell<Vec<TimerCmd>>>,
    fetch_promises: Rc<RefCell<std::collections::HashMap<u32, FetchPromise>>>,
    shared_event_data: rquickjs::Persistent<Value<'static>>,
    last_gc: std::time::Instant,
    vite_origin: Option<url::Url>,
    vite_cache: Option<crate::vite::ViteModuleCache>,
    ctx: Context,
    _rt: Runtime,
}

impl JsRuntime {
    pub fn new() -> JsResult<Self> {
        Self::new_inner(None)
    }

    pub fn new_vite(server_url: &str) -> JsResult<Self> {
        let origin = url::Url::parse(server_url).map_err(|_| rquickjs::Error::Unknown)?;
        Self::new_inner(Some(origin))
    }

    fn new_inner(vite_origin: Option<url::Url>) -> JsResult<Self> {
        let rt = Runtime::new()?;
        // QuickJS's default GC threshold is high enough that rquickjs Value
        // wrappers (which hold refs on the Rust side) can accumulate without
        // triggering automatic collection — observed as a steady memory rise
        // on any event-driven tick (mouse move, window restore). A low
        // threshold makes the automatic GC kick in far more often.
        rt.set_gc_threshold(256 * 1024);
        rt.set_max_stack_size(2048 * 1024); // Increase JS call stack to 2MB for deep UI trees
        let vite_cache = vite_origin
            .as_ref()
            .map(|_| crate::vite::ViteModuleCache::default());
        if let (Some(origin), Some(cache)) = (vite_origin.clone(), vite_cache.clone()) {
            rt.set_loader(
                crate::vite::ViteResolver::new(origin),
                crate::vite::ViteLoader::new(cache).map_err(|_| rquickjs::Error::Unknown)?,
            );
        }
        let ctx = Context::full(&rt)?;
        let out: Rc<RefCell<Vec<u8>>> = Rc::new(RefCell::new(Vec::new()));
        let timer_cmds = Rc::new(RefCell::new(Vec::new()));
        let fetch_promises = Rc::new(RefCell::new(std::collections::HashMap::new()));

        let shared_event_data =
            ctx.with(|ctx| -> JsResult<rquickjs::Persistent<Value<'static>>> {
                let globals = ctx.globals();
                let arr = TypedArray::<f64>::new(
                    ctx.clone(),
                    vec![0.0; crate::protocol::event_data::LEN],
                )?;
                globals.set("__blitz_event_data", arr.clone())?;
                Ok(rquickjs::Persistent::save(&ctx, arr.into_value()))
            })?;

        ctx.with(|ctx| -> JsResult<()> {
            let globals = ctx.globals();

            // __bridge_flush(Uint8Array) -> copies the frame bytes out.
            {
                let out = out.clone();
                let f = Function::new(ctx.clone(), move |buf: TypedArray<u8>| -> JsResult<()> {
                    if let Some(bytes) = buf.as_bytes() {
                        *out.borrow_mut() = bytes.to_vec();
                    }
                    Ok(())
                })?;
                globals.set("__bridge_flush", f)?;
            }

            // Stateless host functions registered via macros
            globals.set(
                "__host_log",
                rquickjs::Function::new(ctx.clone(), crate::host_ffi::host_log)?,
            )?;
            globals.set(
                "__host_log_level",
                rquickjs::Function::new(ctx.clone(), crate::host_ffi::host_log_level)?,
            )?;
            globals.set(
                "__host_utf8_encode",
                rquickjs::Function::new(ctx.clone(), crate::host_ffi::host_utf8_encode)?,
            )?;
            globals.set(
                "sysInfo",
                rquickjs::Function::new(ctx.clone(), crate::host_ffi::sys_info)?,
            )?;

            let perf = rquickjs::Object::new(ctx.clone())?;
            perf.set(
                "now",
                rquickjs::Function::new(ctx.clone(), crate::host_ffi::performance_now)?,
            )?;
            globals.set("performance", perf)?;

            // __register_timer(id, delay, repeat)
            {
                let timer_cmds = timer_cmds.clone();
                let f = Function::new(
                    ctx.clone(),
                    move |id: u32, delay_ms: u64, repeat: bool| -> JsResult<()> {
                        timer_cmds.borrow_mut().push(TimerCmd::Register {
                            id,
                            delay_ms,
                            repeat,
                        });
                        Ok(())
                    },
                )?;
                globals.set("__register_timer", f)?;
            }

            // __unregister_timer(id)
            {
                let timer_cmds = timer_cmds.clone();
                let f = Function::new(ctx.clone(), move |id: u32| -> JsResult<()> {
                    timer_cmds.borrow_mut().push(TimerCmd::Unregister { id });
                    Ok(())
                })?;
                globals.set("__unregister_timer", f)?;
            }

            Ok(())
        })?;

        Ok(Self {
            _rt: rt,
            ctx,
            out,
            booted: false,
            timer_cmds,
            fetch_promises,
            shared_event_data,
            last_gc: std::time::Instant::now(),
            vite_origin,
            vite_cache,
        })
    }

    pub fn boot_vite(&mut self, server_url: &str, entry: &str) -> JsResult<()> {
        if self.booted {
            return Ok(());
        }
        let origin = url::Url::parse(server_url).map_err(|_| rquickjs::Error::Unknown)?;
        let entry = origin
            .join(entry)
            .map_err(|_| rquickjs::Error::Unknown)?
            .to_string();
        let entry_literal = serde_json::to_string(&entry).map_err(|_| rquickjs::Error::Unknown)?;
        let ctx = self.ctx.clone();
        ctx.with(|ctx| -> JsResult<()> {
            use rquickjs::CatchResultExt;

            let result = Module::evaluate(
                ctx.clone(),
                "blitz-quick:vite-entry",
                format!("import {entry_literal};"),
            )
            .and_then(|promise| promise.finish::<()>());
            match result.catch(&ctx) {
                Ok(()) => Ok(()),
                Err(caught) => {
                    match &caught {
                        rquickjs::CaughtError::Exception(exception) => {
                            tracing::error!(
                                entry = %entry,
                                message = exception.message().as_deref().unwrap_or("unknown"),
                                stack = exception.stack().as_deref().unwrap_or("unavailable"),
                                "failed to evaluate Vite entry"
                            );
                        }
                        _ => {
                            tracing::error!(entry = %entry, error = %caught, "failed to evaluate Vite entry");
                        }
                    }
                    Err(caught.throw(&ctx))
                }
            }
        })?;
        self.booted = true;
        Ok(())
    }

    pub fn apply_hmr_update(
        &mut self,
        path: &str,
        accepted_path: &str,
        timestamp: u64,
        source: String,
    ) -> JsResult<bool> {
        let origin = self.vite_origin.as_ref().ok_or(rquickjs::Error::Unknown)?;
        let mut update_url = origin
            .join(accepted_path)
            .map_err(|_| rquickjs::Error::Unknown)?;
        update_url
            .query_pairs_mut()
            .append_pair("t", &timestamp.to_string());
        self.vite_cache
            .as_ref()
            .ok_or(rquickjs::Error::Unknown)?
            .insert(update_url.into(), source);
        let ctx = self.ctx.clone();
        ctx.with(|ctx| -> JsResult<bool> {
            let apply: Function = ctx.globals().get("__blitz_apply_hmr")?;
            let promise: rquickjs::Promise = apply.call((path, accepted_path, timestamp))?;
            promise.finish()
        })
    }

    pub fn register_fetch(
        &self,
        bridge: std::sync::Arc<crate::fetch::FetchBridge>,
    ) -> JsResult<()> {
        let ctx = self.ctx.clone();
        let fetch_promises = self.fetch_promises.clone();
        ctx.with(|ctx| -> JsResult<()> {
            let f = Function::new(
                ctx.clone(),
                move |id: u32,
                      url: String,
                      method: String,
                      headers: String,
                      body: Option<String>,
                      resolve: rquickjs::Persistent<Function<'static>>,
                      _reject: rquickjs::Persistent<Function<'static>>|
                      -> JsResult<()> {
                    fetch_promises
                        .borrow_mut()
                        .insert(id, FetchPromise { resolve });
                    bridge.start_fetch(id, url, method, headers, body);
                    Ok(())
                },
            )?;
            ctx.globals().set("__fetch_start", f)?;
            Ok(())
        })
    }

    /// Evaluate the bundled app. The IIFE registers host glue and runs the
    /// app's initial render (emitting ops into the writer, flushed on first
    /// tick). Call once before ticking. `source` is the bundle text — in dev
    /// pass the application's current bundle contents. The embedding host owns
    /// asset loading and hot-reload policy.
    pub fn boot(&mut self, source: &str) -> JsResult<()> {
        if self.booted {
            return Ok(());
        }
        let ctx = self.ctx.clone();
        let src = source.to_string();
        ctx.with(|ctx| -> JsResult<()> {
            use rquickjs::prelude::CatchResultExt;
            ctx.eval::<(), _>(src.as_str())
                .catch(&ctx)
                .map_err(|caught| {
                    match caught {
                        rquickjs::CaughtError::Value(v) => {
                            let s: String = v
                                .as_string()
                                .map(|s| s.to_string().unwrap_or_default())
                                .unwrap_or_default();
                            println!("boot app failed (value): {}", s);
                        }
                        rquickjs::CaughtError::Exception(e) => {
                            println!("boot app failed (exception): {:?}", e);
                            if let Some(msg) = e.message() {
                                println!("  Message: {}", msg);
                            }
                            if let Some(stack) = e.stack() {
                                println!("  Stack: {}", stack);
                            }
                        }
                        rquickjs::CaughtError::Error(e) => {
                            println!("boot app failed (error): {:?}", e)
                        }
                    }
                    rquickjs::Error::Unknown
                })?;
            Ok(())
        })?;
        self.booted = true;
        Ok(())
    }

    /// Run one rAF tick: drains the JS requestAnimationFrame queue (which makes
    /// Solid reactive updates emit ops into the writer), then flushes the
    /// writer — which calls `__bridge_flush` and lands the bytes in `self.out`.
    /// Returns the frame bytes (empty if nothing changed this tick) and whether
    /// more rAF callbacks remain queued (so the host can keep redrawing).
    pub fn tick(&mut self) -> JsResult<(Vec<u8>, bool)> {
        self.out.borrow_mut().clear();
        let ctx = self.ctx.clone();
        let has_raf = ctx.with(|ctx| -> JsResult<bool> {
            let globals = ctx.globals();
            let tick: Function = globals.get("__tick")?;
            // __tick runs queued rAF callbacks, flushes, and returns whether
            // more rAF callbacks remain queued.
            let res = tick.call::<(), bool>(());

            while ctx.execute_pending_job() {}

            // rquickjs Value wrappers hold refs on the Rust side, invisible to
            // QuickJS's malloc-counted automatic GC — they accumulate on every
            // Only manual collection reclaims them. Cheap when little has changed,
            // but we throttle it to avoid overhead during high framerates.
            // ctx.run_gc(); // Done outside the with block so we can mutate self.last_gc

            res
        })?;

        if self.last_gc.elapsed() >= std::time::Duration::from_millis(250) {
            self.ctx.with(|ctx| ctx.run_gc());
            self.last_gc = std::time::Instant::now();
        }

        Ok((self.out.borrow().clone(), has_raf))
    }

    /// Whether any rAF callbacks are queued on the JS side. The host uses this
    /// to decide whether to keep redrawing (rAF-driven, vsync-aligned).
    pub fn has_raf(&mut self) -> bool {
        let ctx = self.ctx.clone();
        ctx.with(|ctx| -> bool {
            let globals = ctx.globals();
            let f: Function = match globals.get("__hasRaf") {
                Ok(f) => f,
                Err(_) => return false,
            };
            f.call::<(), bool>(()).unwrap_or(false)
        })
    }

    /// Dispatch a DOM event from Rust back into a Solid handler. `payload` is
    /// a JSON string the JS side parses into an event object (clientX, key,
    /// etc.). An empty payload means "no detail" (e.g. focus/blur).
    pub fn dispatch_event(&mut self, solid_id: u32, event_type: u8, payload: &str) -> JsResult<()> {
        let ctx = self.ctx.clone();
        let payload = payload.to_string();
        ctx.with(move |ctx| -> JsResult<()> {
            let globals = ctx.globals();
            let f: Function = globals.get("__dispatchEvent")?;
            let _: Value = f.call((solid_id, event_type, payload))?;
            Ok(())
        })
    }

    pub fn dispatch_shared_numeric_event(
        &mut self,
        solid_id: u32,
        event_type: u8,
        data: [f64; crate::protocol::event_data::LEN],
    ) -> JsResult<()> {
        let ctx = self.ctx.clone();
        let shared_event_data = self.shared_event_data.clone();
        ctx.with(move |ctx| -> JsResult<()> {
            let arr = shared_event_data.restore(&ctx)?;
            let arr = TypedArray::<f64>::from_value(arr)?;
            if let Some(raw) = arr.as_raw()
                && raw.len >= std::mem::size_of_val(&data)
            {
                unsafe {
                    std::ptr::copy_nonoverlapping(
                        data.as_ptr().cast::<u8>(),
                        raw.ptr.as_ptr(),
                        std::mem::size_of_val(&data),
                    );
                }
            }
            let globals = ctx.globals();
            let f: Function = globals.get("__dispatchEvent")?;
            let _: Value = f.call((solid_id, event_type, ""))?;
            Ok(())
        })
    }

    pub fn resolve_fetches(&self, completions: Vec<crate::fetch::FetchCompletion>) -> JsResult<()> {
        if completions.is_empty() {
            return Ok(());
        }
        let ctx = self.ctx.clone();
        ctx.with(|ctx| -> JsResult<()> {
            for c in completions {
                let pending = self.fetch_promises.borrow_mut().remove(&c.id);
                let Some(pending) = pending else {
                    continue;
                };
                match c.outcome {
                    crate::fetch::FetchOutcome::Ok {
                        status,
                        url: _,
                        body,
                    } => {
                        let resolve = pending.resolve.restore(&ctx)?;
                        let res_obj = rquickjs::Object::new(ctx.clone())?;
                        res_obj.set("status", status)?;
                        if let Ok(text) = String::from_utf8(body) {
                            res_obj.set("body", text)?;
                        }
                        resolve.call::<_, ()>((res_obj,))?;
                    }
                    crate::fetch::FetchOutcome::Err { message } => {
                        let resolve = pending.resolve.restore(&ctx)?;
                        let res_obj = rquickjs::Object::new(ctx.clone())?;
                        res_obj.set("error", message)?;
                        resolve.call::<_, ()>((res_obj,))?;
                    }
                }
            }
            while ctx.execute_pending_job() {}
            Ok(())
        })
    }

    /// Access the underlying context (for advanced embedding).
    pub fn context(&self) -> &Context {
        &self.ctx
    }

    pub fn take_timer_cmds(&self) -> Vec<TimerCmd> {
        self.timer_cmds.borrow_mut().drain(..).collect()
    }

    pub fn trigger_timer(&self, timer_id: u32) -> JsResult<()> {
        let ctx = self.ctx.clone();
        ctx.with(|ctx| -> JsResult<()> {
            let globals = ctx.globals();
            let trigger: Function = globals.get("__triggerTimer")?;
            let _: Value = trigger.call((timer_id,))?;
            Ok(())
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn boots_and_emits_initial_frame() {
        let mut rt = JsRuntime::new().expect("runtime");
        let fetch = std::sync::Arc::new(crate::fetch::FetchBridge::new());
        rt.register_fetch(fetch.clone())
            .expect("failed to register fetch host fn");
        rt.boot(TEST_BUNDLE).expect("boot");
        // First tick flushes the app's initial render.
        let (frame0, _) = rt.tick().expect("tick0");
        assert!(!frame0.is_empty(), "initial render should emit ops");
    }

    #[test]
    fn fetch_resolves_in_js() {
        use crate::fetch::{FetchBridge, FetchCompletion};
        use std::sync::Arc;

        let mut rt = JsRuntime::new().expect("runtime");
        let bridge = Arc::new(FetchBridge::new());
        bridge.set_waker(std::task::Waker::noop());
        rt.register_fetch(bridge.clone()).expect("register fetch");
        rt.boot(TEST_BUNDLE).expect("boot");

        // Kick off a fetch from JS and stash the resolved text in a global.
        rt.context().with(|ctx| {
            ctx.eval::<(), _>(
                r#"
                globalThis.__fetched = null;
                globalThis.__fetchedErr = null;
                fetch("data:text/plain;base64,aGVsbG8=")
                  .then(function (r) { return r.text(); })
                  .then(function (t) { globalThis.__fetched = t; })
                  .catch(function (e) { globalThis.__fetchedErr = String(e); });
                "#,
            )
            .expect("eval fetch");
        });

        // Wait for the blitz-net worker to complete, drain, and dispatch into JS.
        let mut got = None;
        for _ in 0..200 {
            let completions: Vec<FetchCompletion> = bridge.drain();
            if !completions.is_empty() {
                rt.resolve_fetches(completions)
                    .expect("resolve fetch completion");
            }
            let (text, err) = rt.context().with(|ctx| {
                let t: Option<String> = ctx.globals().get("__fetched").ok().flatten();
                let e: Option<String> = ctx.globals().get("__fetchedErr").ok().flatten();
                (t, e)
            });
            if let Some(e) = err {
                panic!("fetch rejected in JS: {e}");
            }
            if let Some(t) = text {
                got = Some(t);
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        assert_eq!(got.expect("fetch never resolved in JS"), "hello");
    }
}
