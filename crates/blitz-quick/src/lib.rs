//! QuickJS-driven Solid renderer backed by Blitz.

mod applier;
mod dom_updater;
mod events;
mod host_ffi;
mod jsrt;
mod protocol;
mod resize;
#[cfg(feature = "vite")]
mod vite;

pub use applier::{AppConfig, Applier, ApplierError, ReloadHandle, ReloadMsg};
pub use jsrt::JsRuntime;

// Re-export rquickjs so embedding apps can write extensions without adding
// rquickjs as a direct dependency.
pub use rquickjs;

#[cfg(feature = "vite")]
pub use vite::{ViteError, start_hmr_client, vite_url_from_env};
