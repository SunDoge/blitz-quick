//! blitz-quick driver: runs a Solid app on QuickJS, ferries each rAF tick's DOM
//! mutations over the binary bridge into a blitz-dom document, and renders it
//! either live in a winit window or to a PNG (--screenshot mode). See
//! DESIGN.md for the full scheme.

#![allow(dead_code)]

mod applier;
mod fetch;
mod host_ffi;
mod jsrt;
mod protocol;

use std::sync::Arc;

use anyrender_vello::VelloWindowRenderer as WindowRenderer;
use blitz::shell::{
    BlitzApplication, BlitzShellProxy, EventLoop, WindowConfig, create_default_event_loop,
};
use blitz::traits::net::DummyNetProvider;

use crate::applier::{Applier, RENDER_HEIGHT, RENDER_SCALE, RENDER_WIDTH};

fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    let args: Vec<String> = std::env::args().collect();
    if args.iter().any(|a| a == "--screenshot") {
        run_screenshot();
    } else {
        run_window();
    }
}

/// Live window mode: the Applier is a blitz Document; on each poll() it runs
/// one JS tick (rAF-driven) and keeps the window redrawing while callbacks
/// remain queued. A file watcher hot-reloads bundle.js on change.
fn run_window() {
    let mut applier = Applier::new(Box::new(|js| {
        // Let user register their custom ffi functions using rquickjs directly
        js.context().with(|ctx| {
            let f = rquickjs::Function::new(ctx.clone(), |msg: String| {
                tracing::info!("JS FFI says: {}", msg);
                format!("Rust received: {}", msg)
            })
            .unwrap();
            ctx.globals().set("myCustomFfi", f).unwrap();
        });
    }));

    // Watch src/gen: on change, signal the applier to reload JS or CSS.
    // The watcher runs on its own thread; the applier drains the signal on the main thread in poll().
    let gen_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/gen");
    let (tx, rx) = std::sync::mpsc::channel::<crate::applier::ReloadMsg>();
    if gen_dir.exists() {
        start_bundle_watcher(gen_dir, tx);
        applier.set_reload_channel(rx);
    } else {
        tracing::warn!(?gen_dir, "gen directory not found — hot-reload disabled");
    }

    let event_loop: EventLoop = create_default_event_loop();
    let (proxy, receiver) = BlitzShellProxy::new(event_loop.create_proxy());
    let mut application: BlitzApplication<WindowRenderer> = BlitzApplication::new(proxy, receiver);

    let renderer = WindowRenderer::new();
    let window = WindowConfig::new(Box::new(applier) as _, renderer);
    application.add_window(window);

    event_loop.run_app(application).unwrap();
}

/// Watch `dir` for modifications; on change to bundle.js or bundle.css (debounced ~200ms)
/// send the appropriate ReloadMsg.
fn start_bundle_watcher(
    dir: std::path::PathBuf,
    tx: std::sync::mpsc::Sender<crate::applier::ReloadMsg>,
) {
    use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
    use std::sync::{Arc, Mutex};
    use std::time::{Duration, Instant};

    let dir = Arc::new(dir);
    let tx = Arc::new(Mutex::new(tx));
    let last_js = Arc::new(Mutex::new(Instant::now() - Duration::from_secs(60)));
    let last_css = Arc::new(Mutex::new(Instant::now() - Duration::from_secs(60)));

    let mut watcher = RecommendedWatcher::new(
        move |res: notify::Result<notify::Event>| {
            let event = match res {
                Ok(e) => e,
                Err(_) => return,
            };
            if !matches!(event.kind, EventKind::Modify(_) | EventKind::Create(_)) {
                return;
            }

            let mut changed_js = false;
            let mut changed_css = false;
            for p in &event.paths {
                if let Some(filename) = p.file_name().and_then(|f| f.to_str()) {
                    if filename == "bundle.js" {
                        changed_js = true;
                    } else if filename == "bundle.css" {
                        changed_css = true;
                    }
                }
            }

            if changed_js {
                let mut last = last_js.lock().unwrap();
                if last.elapsed() >= Duration::from_millis(200) {
                    *last = Instant::now();
                    let _ = tx.lock().unwrap().send(crate::applier::ReloadMsg::Js);
                }
            }
            if changed_css {
                let mut last = last_css.lock().unwrap();
                if last.elapsed() >= Duration::from_millis(200) {
                    *last = Instant::now();
                    let _ = tx.lock().unwrap().send(crate::applier::ReloadMsg::Css);
                }
            }
        },
        notify::Config::default(),
    )
    .expect("watcher");

    watcher
        .watch(&*dir, RecursiveMode::NonRecursive)
        .expect("watch gen dir");

    // Keep the watcher alive for the process lifetime on a dedicated thread.
    std::thread::spawn(move || {
        let _watcher = watcher;
        loop {
            std::thread::sleep(Duration::from_secs(3600));
        }
    });
    tracing::info!(?dir, "watching directory for JS and CSS changes");
}

/// Screenshot mode: run N rAF ticks headless, resolve + layout + render to a
/// PNG. No window, no GPU. Useful for CI and visual verification.
fn run_screenshot() {
    let mut applier = Applier::new(Box::new(|_| {}));

    // Run enough ticks to let the app's rAF loop settle.
    for _ in 0..8 {
        applier.tick_once();
    }

    // Resolve styles + layout.
    applier.document_mut().resolve(0.0);

    // Offscreen-render to PNG via Vello CPU.
    let (w, h) = (RENDER_WIDTH, RENDER_HEIGHT);
    let rw = (w as f64 * RENDER_SCALE) as u32;
    let rh = (h as f64 * RENDER_SCALE) as u32;
    let rgba = render_dom_to_rgba(applier.document_mut(), RENDER_SCALE, rw, rh);
    match image::save_buffer("frame.png", &rgba, rw, rh, image::ExtendedColorType::Rgba8) {
        Ok(()) => tracing::info!("== wrote frame.png ({rw}x{rh}) =="),
        Err(e) => tracing::error!(error = ?e, "failed to write PNG"),
    }

    let _ = Arc::new(DummyNetProvider);
}

/// Paint a resolved+laid-out BaseDocument into an RGBA8 buffer using
/// anyrender_vello_cpu's VelloCpuImageRenderer (pure CPU, no wgpu/GPU).
fn render_dom_to_rgba(dom: &mut blitz::dom::BaseDocument, scale: f64, w: u32, h: u32) -> Vec<u8> {
    use anyrender::ImageRenderer as _;
    use anyrender::PaintScene as _;
    use anyrender_vello_cpu::VelloCpuImageRenderer;
    use peniko::kurbo::Rect;
    use peniko::{Color, Fill};

    let mut renderer = VelloCpuImageRenderer::new(w, h);
    let mut buf = Vec::with_capacity((w * h * 4) as usize);
    renderer.render_to_vec(
        |scene| {
            scene.fill(
                Fill::NonZero,
                Default::default(),
                Color::from_rgba8(255, 255, 255, 255),
                None,
                &Rect::new(0.0, 0.0, w as f64, h as f64),
            );
            blitz::paint::paint_scene(scene, dom, scale, w, h, 0, 0);
        },
        &mut buf,
    );
    buf
}
