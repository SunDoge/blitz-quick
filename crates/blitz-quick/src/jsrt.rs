//! QuickJS host (via rquickjs).
//!
//! Owns the runtime + context, injects the host functions the JS side needs
//! (`__bridge_flush`, `__host_log`), loads `runtime.js` + `app.js`, and exposes
//! a `tick()` that runs the requestAnimationFrame queue for one frame and
//! returns the flushed binary frame bytes.

use std::cell::RefCell;
use std::rc::Rc;
use std::task::Context as TaskContext;

use rquickjs::{AsyncContext, AsyncRuntime, Ctx, Function, TypedArray, Value};
type JsResult<T> = rquickjs::Result<T>;

const CORE_PRELUDE: &str = include_str!("gen/core-prelude.js");
const MEMORY_LOG_INTERVAL: std::time::Duration = std::time::Duration::from_secs(5);

#[cfg(test)]
pub(crate) const TEST_RUNTIME: &str = include_str!("gen/test-runtime.js");

#[derive(serde::Deserialize, Default)]
struct FetchInit {
    method: Option<String>,
    headers: Option<std::collections::HashMap<String, String>>,
    body: Option<String>,
}

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

pub struct JsRuntime {
    /// Bytes flushed by the most recent `__bridge_flush` call.
    out: Rc<RefCell<Vec<u8>>>,
    /// True once the app's initial render has been evaluated.
    booted: bool,
    timer_cmds: Rc<RefCell<Vec<TimerCmd>>>,
    shared_event_data: rquickjs::Persistent<Value<'static>>,
    last_memory_log: std::time::Instant,
    #[cfg(feature = "vite")]
    vite: Option<crate::vite::ViteState>,
    #[cfg(feature = "vite")]
    vite_styles: Rc<RefCell<Vec<(String, String)>>>,
    ctx: AsyncContext,
    rt: AsyncRuntime,
    /// Tokio runtime + LocalSet that drives rquickjs async jobs. rquickjs
    /// runtime is !Send, so we use multi-thread tokio + LocalSet. `with()`
    /// enters the tokio context and calls `local.block_on` so async host
    /// functions (reqwest, timers) can `.await` tokio futures.
    _tokio: tokio::runtime::Runtime,
    _local: tokio::task::LocalSet,
}

impl JsRuntime {
    pub fn new() -> JsResult<Self> {
        Self::new_inner()
    }

    #[cfg(feature = "vite")]
    pub fn new_vite(server_url: &str) -> JsResult<Self> {
        let origin = url::Url::parse(server_url).map_err(|_| rquickjs::Error::Unknown)?;
        let vite = crate::vite::ViteState::new(origin);
        let rt = AsyncRuntime::new()?;
        futures_lite::future::block_on(async {
            rt.set_max_stack_size(2048 * 1024).await;
        });
        vite.install_loader(&rt)?;
        let mut this = Self::build_inner(rt)?;
        this.vite = Some(vite);
        Ok(this)
    }

    fn new_inner() -> JsResult<Self> {
        let rt = AsyncRuntime::new()?;
        futures_lite::future::block_on(async {
            rt.set_max_stack_size(2048 * 1024).await;
        });
        Self::build_inner(rt)
    }

    fn build_inner(rt: AsyncRuntime) -> JsResult<Self> {
        // Multi-thread tokio runtime for driving async host functions.
        // rquickjs runtime is !Send so we use a LocalSet for rt.drive().
        let tokio_rt = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .enable_all()
            .build()?;
        let local = tokio::task::LocalSet::new();

        let ctx = futures_lite::future::block_on(AsyncContext::full(&rt))?;
        let out: Rc<RefCell<Vec<u8>>> = Rc::new(RefCell::new(Vec::new()));
        let timer_cmds = Rc::new(RefCell::new(Vec::new()));
        #[cfg(feature = "vite")]
        let vite_styles = Rc::new(RefCell::new(Vec::<(String, String)>::new()));
        let shared_event_data = futures_lite::future::block_on(ctx.with(
            |ctx| -> JsResult<rquickjs::Persistent<Value<'static>>> {
                let globals = ctx.globals();
                let arr = TypedArray::<f64>::new(
                    ctx.clone(),
                    vec![0.0; crate::protocol::event_data::LEN],
                )?;
                globals.set("__blitz_event_data", arr.clone())?;
                Ok(rquickjs::Persistent::save(&ctx, arr.into_value()))
            },
        ))?;

        futures_lite::future::block_on(ctx.with(|ctx| -> JsResult<()> {
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

            // Stateless host functions are installed by `register_core_host_fns`
            // (kept grouped there so this init block only holds the stateful
            // closures that capture local Rc<RefCell<..>> handles).

            #[cfg(feature = "vite")]
            {
                let styles = vite_styles.clone();
                globals.set(
                    "__vite_update_style",
                    Function::new(ctx.clone(), move |id: String, css: String| {
                        let mut styles = styles.borrow_mut();
                        if let Some((_, current)) =
                            styles.iter_mut().find(|(current_id, _)| current_id == &id)
                        {
                            *current = css;
                        } else {
                            styles.push((id, css));
                        }
                    })?,
                )?;

                let styles = vite_styles.clone();
                globals.set(
                    "__vite_remove_style",
                    Function::new(ctx.clone(), move |id: String| {
                        styles
                            .borrow_mut()
                            .retain(|(current_id, _)| current_id != &id);
                    })?,
                )?;
            }

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
        }))?;

        let this = Self {
            rt,
            ctx,
            out,
            booted: false,
            timer_cmds,
            shared_event_data,
            last_memory_log: std::time::Instant::now(),
            #[cfg(feature = "vite")]
            vite: None,
            #[cfg(feature = "vite")]
            vite_styles,
            _tokio: tokio_rt,
            _local: local,
        };
        this.register_core_host_fns()?;
        this.register_fetch()?;
        this.install_core_prelude()?;
        Ok(this)
    }

    fn install_core_prelude(&self) -> JsResult<()> {
        self.with(|ctx| ctx.eval::<(), _>(CORE_PRELUDE))
    }

    /// Install the stateless host functions: logging, UTF-8 codec, `sysInfo`,
    /// and `performance.now`. None of these capture per-runtime state, so they
    /// just wrap the `host_ffi` functions. Grouped here (rather than inlined
    /// in `new_inner`) so all host-fn registration follows the same
    /// `register_*` shape — see also `register_resize`, and
    /// the timer closures set up during construction.
    pub fn register_core_host_fns(&self) -> JsResult<()> {
        self.with(|ctx| -> JsResult<()> {
            let globals = ctx.globals();
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
                "__host_utf8_decode",
                rquickjs::Function::new(ctx.clone(), crate::host_ffi::host_utf8_decode)?,
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
            Ok(())
        })
    }

    /// Register the `fetch` host function backed by async reqwest. JS calls
    /// `__fetch(url, initJson) -> Promise<FetchResponseJson>`; the JS-side
    /// polyfill in `@blitz-quick/core` wraps this into a standard `Response`.
    pub fn register_fetch(&self) -> JsResult<()> {
        self.with(|ctx| {
            let client = reqwest::Client::builder()
                .no_proxy()
                .build()
                .map_err(|_| rquickjs::Error::Unknown)?;

            let f = Function::new(
                ctx.clone(),
                rquickjs::prelude::Async(move |url: String, init_json: String| {
                    let client = client.clone();
                    async move {
                        let init: FetchInit = serde_json::from_str(&init_json).unwrap_or_default();

                        let method = match init.method.as_deref() {
                            Some("POST") => reqwest::Method::POST,
                            Some("PUT") => reqwest::Method::PUT,
                            Some("DELETE") => reqwest::Method::DELETE,
                            Some("PATCH") => reqwest::Method::PATCH,
                            Some("HEAD") => reqwest::Method::HEAD,
                            _ => reqwest::Method::GET,
                        };

                        let mut req = client.request(method, &url);
                        if let Some(headers) = &init.headers {
                            for (k, v) in headers {
                                req = req.header(k, v);
                            }
                        }
                        if let Some(body) = init.body {
                            req = req.body(body);
                        }

                        let response = req.send().await.map_err(|_| rquickjs::Error::Unknown)?;

                        let status = response.status().as_u16();
                        let status_text = response
                            .status()
                            .canonical_reason()
                            .unwrap_or("")
                            .to_string();
                        let headers: std::collections::HashMap<String, String> = response
                            .headers()
                            .iter()
                            .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string()))
                            .collect();
                        let body = response
                            .text()
                            .await
                            .map_err(|_| rquickjs::Error::Unknown)?;

                        let result = serde_json::json!({
                            "status": status,
                            "statusText": status_text,
                            "headers": headers,
                            "body": body,
                        });

                        serde_json::to_string(&result).map_err(|_| rquickjs::Error::Unknown)
                    }
                }),
            )?;
            ctx.globals().set("__fetch", f)?;
            Ok(())
        })
    }

    /// Run a synchronous closure while holding the async QuickJS context lock.
    /// Enters the tokio runtime context so async host functions can access
    /// `Handle::current()`, and drives the LocalSet so `rt.drive()` makes
    /// progress while we wait for the context lock.
    pub fn with<F, R>(&self, f: F) -> R
    where
        F: for<'js> FnOnce(Ctx<'js>) -> R + rquickjs::markers::ParallelSend,
        R: rquickjs::markers::ParallelSend,
    {
        let _guard = self._tokio.handle().enter();
        self._local.block_on(&self._tokio, self.ctx.with(f))
    }

    /// Drive rquickjs async jobs and report whether more async work remains.
    /// Pending work is not itself a redraw request; the resulting protocol
    /// frame, if any, decides whether the shell needs to render.
    pub fn poll_pending_jobs(&self, _task_context: &mut TaskContext<'_>) -> Result<bool, String> {
        let _guard = self._tokio.handle().enter();
        let pending = self._local.block_on(&self._tokio, async {
            let _ = tokio::time::timeout(std::time::Duration::from_millis(1), self.rt.idle()).await;
            self.rt.is_job_pending().await
        });
        Ok(pending)
    }

    #[cfg(feature = "vite")]
    pub fn boot_vite(&mut self, _server_url: &str, entry: &str) -> JsResult<()> {
        if self.booted {
            return Ok(());
        }
        let vite = self.vite.as_ref().ok_or(rquickjs::Error::Unknown)?;
        self.with(|ctx| vite.boot(&ctx, entry))?;
        self.booted = true;
        Ok(())
    }

    #[cfg(feature = "vite")]
    pub fn vite_stylesheet(&self) -> String {
        self.vite_styles
            .borrow()
            .iter()
            .map(|(_, css)| css.as_str())
            .collect::<Vec<_>>()
            .join("\n")
    }

    #[cfg(feature = "vite")]
    pub fn update_vite_style(&self, id: &str, css: String) {
        let mut styles = self.vite_styles.borrow_mut();
        if let Some((_, current)) = styles.iter_mut().find(|(current_id, _)| current_id == id) {
            *current = css;
        } else {
            styles.push((id.to_string(), css));
        }
    }

    #[cfg(feature = "vite")]
    pub fn apply_hmr_update(
        &mut self,
        path: &str,
        accepted_path: &str,
        timestamp: u64,
        source: String,
    ) -> JsResult<bool> {
        let vite = self.vite.as_ref().ok_or(rquickjs::Error::Unknown)?;
        self.with(|ctx| vite.apply_hmr(&ctx, path, accepted_path, timestamp, source))
    }

    /// Register the `ResizeObserver` host functions (`__resize_observe`,
    /// `__resize_unobserve`) backed by a [`ResizeBridge`]. The Applier measures
    /// observed targets after each resolve and the JS runtime drains the
    /// resulting changes via [`drain_resize`].
    pub fn register_resize(&self, bridge: &crate::resize::ResizeBridge) -> JsResult<()> {
        let targets = bridge.targets_handle();
        self.with(|ctx| -> JsResult<()> {
            let t = targets.clone();
            let f = Function::new(ctx.clone(), move |solid_id: u32| -> JsResult<()> {
                t.lock().unwrap().insert(solid_id, Default::default());
                Ok(())
            })?;
            ctx.globals().set("__resize_observe", f)?;

            let t = targets.clone();
            let f = Function::new(ctx.clone(), move |solid_id: u32| -> JsResult<()> {
                t.lock().unwrap().remove(&solid_id);
                Ok(())
            })?;
            ctx.globals().set("__resize_unobserve", f)?;
            Ok(())
        })
    }

    /// Drain pending size changes from the bridge and dispatch each to the JS
    /// `__resize_dispatch(solid_id, width, height)` global, which the
    /// `ResizeObserver` polyfill uses to invoke the matching observer callback.
    pub fn drain_resize(&self, bridge: &crate::resize::ResizeBridge) -> JsResult<()> {
        let changes = bridge.drain();
        if changes.is_empty() {
            return Ok(());
        }
        self.with(|ctx| -> JsResult<()> {
            let globals = ctx.globals();
            let f: Function = globals.get("__resize_dispatch")?;
            for c in changes {
                let _: Value = f.call((c.solid_id, c.width, c.height))?;
            }
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
        let src = source.to_string();
        self.with(|ctx| -> JsResult<()> {
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
        let has_raf = self.with(|ctx| -> JsResult<bool> {
            let globals = ctx.globals();
            let tick: Function = globals.get("__tick")?;
            // __tick runs queued rAF callbacks, flushes, and returns whether
            // more rAF callbacks remain queued.
            let res = tick.call::<(), bool>(());

            while ctx.execute_pending_job() {}

            res
        })?;

        if self.last_memory_log.elapsed() >= MEMORY_LOG_INTERVAL {
            let usage = futures_lite::future::block_on(self.rt.memory_usage());
            tracing::info!(
                target: "blitz_quick::memory",
                malloc_size = usage.malloc_size,
                memory_used_size = usage.memory_used_size,
                malloc_count = usage.malloc_count,
                memory_used_count = usage.memory_used_count,
                atom_count = usage.atom_count,
                atom_size = usage.atom_size,
                string_count = usage.str_count,
                string_size = usage.str_size,
                object_count = usage.obj_count,
                object_size = usage.obj_size,
                property_count = usage.prop_count,
                property_size = usage.prop_size,
                shape_count = usage.shape_count,
                shape_size = usage.shape_size,
                js_function_count = usage.js_func_count,
                js_function_size = usage.js_func_size,
                array_count = usage.array_count,
                fast_array_count = usage.fast_array_count,
                binary_object_count = usage.binary_object_count,
                binary_object_size = usage.binary_object_size,
                "QuickJS memory usage"
            );
            self.last_memory_log = std::time::Instant::now();
        }

        Ok((self.out.borrow().clone(), has_raf))
    }

    /// Whether any rAF callbacks are queued on the JS side. The host uses this
    /// to decide whether to keep redrawing (rAF-driven, vsync-aligned).
    pub fn has_raf(&mut self) -> bool {
        self.with(|ctx| -> bool {
            let globals = ctx.globals();
            let f: Function = match globals.get("__hasRaf") {
                Ok(f) => f,
                Err(_) => return false,
            };
            f.call::<(), bool>(()).unwrap_or(false)
        })
    }

    pub(crate) fn next_memory_log_at(&self) -> std::time::Instant {
        self.last_memory_log + MEMORY_LOG_INTERVAL
    }

    /// Dispatch a DOM event from Rust back into a Solid handler. `payload` is
    /// a JSON string the JS side parses into an event object (clientX, key,
    /// etc.). An empty payload means "no detail" (e.g. focus/blur).
    pub fn dispatch_event(&mut self, solid_id: u32, event_type: u8, payload: &str) -> JsResult<()> {
        let payload = payload.to_string();
        self.with(move |ctx| -> JsResult<()> {
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
        let shared_event_data = self.shared_event_data.clone();
        self.with(move |ctx| -> JsResult<()> {
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

    pub fn take_timer_cmds(&self) -> Vec<TimerCmd> {
        self.timer_cmds.borrow_mut().drain(..).collect()
    }

    pub fn trigger_timer(&self, timer_id: u32) -> JsResult<()> {
        self.with(|ctx| -> JsResult<()> {
            let globals = ctx.globals();
            let trigger: Function = globals.get("__triggerTimer")?;
            let _: Value = trigger.call((timer_id,))?;
            Ok(())
        })
    }
}

#[cfg(test)]
mod tests {
    use std::task::Poll;

    use super::*;

    #[test]
    fn rust_future_resolves_a_js_promise_and_wakes_the_shell() {
        struct WakeCounter(std::sync::atomic::AtomicUsize);

        impl std::task::Wake for WakeCounter {
            fn wake(self: std::sync::Arc<Self>) {
                self.0.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            }

            fn wake_by_ref(self: &std::sync::Arc<Self>) {
                self.0.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            }
        }

        let runtime = JsRuntime::new().expect("runtime");
        let ready = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let future_waker = std::sync::Arc::new(std::sync::Mutex::new(None));
        runtime.with(|ctx| {
            let ready = ready.clone();
            let future_waker = future_waker.clone();
            let function = Function::new(
                ctx.clone(),
                rquickjs::function::Async(move || {
                    let ready = ready.clone();
                    let future_waker = future_waker.clone();
                    async move {
                        futures_lite::future::poll_fn(|ctx| {
                            if ready.load(std::sync::atomic::Ordering::Acquire) {
                                Poll::Ready(())
                            } else {
                                *future_waker.lock().unwrap() = Some(ctx.waker().clone());
                                Poll::Pending
                            }
                        })
                        .await;
                        Ok::<_, rquickjs::Error>(42_u32)
                    }
                }),
            )
            .expect("create async function");
            ctx.globals()
                .set("nativeAsyncValue", function)
                .expect("register async function");
            ctx.eval::<(), _>(
                "globalThis.__asyncValue = null; nativeAsyncValue().then(value => __asyncValue = value);",
            )
            .expect("start Rust future");
        });

        let wake_counter = std::sync::Arc::new(WakeCounter(std::sync::atomic::AtomicUsize::new(0)));
        let waker = std::task::Waker::from(wake_counter.clone());
        let mut task_context = TaskContext::from_waker(&waker);
        runtime
            .poll_pending_jobs(&mut task_context)
            .expect("poll pending future");

        ready.store(true, std::sync::atomic::Ordering::Release);
        let wake_count_before = wake_counter.0.load(std::sync::atomic::Ordering::Relaxed);
        future_waker
            .lock()
            .unwrap()
            .take()
            .expect("future registered a waker")
            .wake();
        assert_eq!(
            wake_counter.0.load(std::sync::atomic::Ordering::Relaxed),
            wake_count_before + 1
        );

        assert!(
            runtime
                .poll_pending_jobs(&mut task_context)
                .expect("resolve Rust future")
        );
        let value = runtime
            .with(|ctx| ctx.globals().get::<_, u32>("__asyncValue"))
            .expect("read resolved value");
        assert_eq!(value, 42);
    }

    #[test]
    fn boots_and_emits_initial_frame() {
        let mut rt = JsRuntime::new().expect("runtime");
        rt.boot(TEST_RUNTIME).expect("boot");
        // First tick flushes the app's initial render.
        let (frame0, _) = rt.tick().expect("tick0");
        assert!(!frame0.is_empty(), "initial render should emit ops");
    }

    #[cfg(feature = "vite")]
    #[test]
    fn collects_vite_styles_in_import_order() {
        let rt = JsRuntime::new().expect("runtime");
        rt.with(|ctx| {
            ctx.eval::<(), _>(
                r#"
                __vite_update_style("base", "body { margin: 0; }");
                __vite_update_style("utilities", ".flex { display: flex; }");
                __vite_update_style("base", "body { margin: 4px; }");
                "#,
            )
            .expect("update Vite styles");
        });
        assert_eq!(
            rt.vite_stylesheet(),
            "body { margin: 4px; }\n.flex { display: flex; }"
        );

        rt.with(|ctx| {
            ctx.eval::<(), _>(r#"__vite_remove_style("base");"#)
                .expect("remove Vite style");
        });
        assert_eq!(rt.vite_stylesheet(), ".flex { display: flex; }");
    }
}
