//! Hacker News app — Rust shell.

use blitz_quick::AppConfig;
use blitz_quick::rquickjs;
use blitz_quick_desktop::DesktopApp;
use snafu::{ResultExt, Whatever};

#[cfg(feature = "vite")]
use blitz_quick::start_hmr_client;

#[cfg(not(feature = "vite"))]
const BUNDLE_JS: &str = include_str!("../dist/bundle.js");
#[cfg(not(feature = "vite"))]
const BUNDLE_CSS: &str = include_str!("../dist/bundle.css");
#[cfg(feature = "vite")]
const DEFAULT_VITE_URL: &str = "http://127.0.0.1:5174";

const HN_API: &str = "https://hacker-news.firebaseio.com/v0";

/// Fetch top 30 HN stories as a JSON string. Runs as an async rquickjs
/// function — rquickjs spawns the future on its tokio-backed async runtime
/// (via `rt.drive()`), so reqwest's async works natively and the JS thread
/// is not blocked.
async fn fetch_top_stories() -> rquickjs::Result<String> {
    let client = reqwest::Client::builder()
        .no_proxy()
        .build()
        .map_err(|_| rquickjs::Error::Unknown)?;

    let ids: Vec<u64> = client
        .get(format!("{HN_API}/topstories.json"))
        .send()
        .await
        .map_err(|_| rquickjs::Error::Unknown)?
        .json()
        .await
        .map_err(|_| rquickjs::Error::Unknown)?;

    let ids: Vec<u64> = ids.into_iter().take(30).collect();

    let mut stories = Vec::with_capacity(ids.len());
    for &id in &ids {
        let story = client
            .get(format!("{HN_API}/item/{id}.json"))
            .send()
            .await
            .ok()
            .and_then(|r| {
                // Can't .await in closure; use block_on for the json parse.
                futures_lite::future::block_on(r.json::<serde_json::Value>()).ok()
            })
            .unwrap_or(serde_json::json!({
                "id": id,
                "title": "[failed to load]",
                "url": "",
                "by": "",
                "score": 0,
                "descendants": 0,
            }));
        stories.push(story);
    }

    serde_json::to_string(&stories).map_err(|_| rquickjs::Error::Unknown)
}

fn main() -> Result<(), Whatever> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .try_init()
        .whatever_context("failed to init tracing")?;

    let net_provider = blitz_net::Provider::shared(None);

    #[cfg(feature = "vite")]
    let vite_url = std::env::var("VITE_URL").unwrap_or_else(|_| DEFAULT_VITE_URL.to_owned());

    #[cfg(feature = "vite")]
    let config = AppConfig::vite(&vite_url, "packages/index.tsx");
    #[cfg(not(feature = "vite"))]
    let config = AppConfig::new(BUNDLE_JS).with_stylesheet(BUNDLE_CSS);

    let app = DesktopApp::new(
        config
            .with_viewport(1040, 720)
            .with_net_provider(net_provider),
    )
    .extension(|js| {
        js.with(|ctx| {
            let f =
                rquickjs::Function::new(ctx.clone(), rquickjs::prelude::Async(fetch_top_stories))?;
            ctx.globals().set("fetchTopStories", f)
        })
    })
    .build()
    .whatever_context("failed to build app")?;

    #[cfg(feature = "vite")]
    {
        let mut app = app;
        let reload = app.applier_mut().reload_handle();
        let _hmr = start_hmr_client(&vite_url, reload)
            .whatever_context("failed to start Vite HMR client")?;
        app.run().whatever_context("app exited with error")?;
    }
    #[cfg(not(feature = "vite"))]
    app.run().whatever_context("app exited with error")?;

    Ok(())
}
