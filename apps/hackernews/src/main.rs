//! Hacker News app — Rust shell.

use blitz_quick::AppConfig;
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
