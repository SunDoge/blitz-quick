//! QuickJS-driven Solid renderer backed by Blitz.

mod applier;
mod dom_updater;
mod events;
mod fetch;
mod host_ffi;
mod jsrt;
mod protocol;
mod resize;
mod vite;

pub use applier::{AppConfig, Applier, ApplierError, ReloadHandle, ReloadMsg};
pub use jsrt::JsRuntime;
