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

#[cfg(feature = "vite")]
pub use vite::{ViteError, start_hmr_client, vite_url_from_env};
