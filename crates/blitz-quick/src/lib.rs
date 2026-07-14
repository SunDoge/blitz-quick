//! QuickJS-driven Solid renderer backed by Blitz.

mod applier;
mod dom_updater;
mod events;
mod fetch;
mod host_ffi;
mod jsrt;
mod protocol;

pub use applier::{AppConfig, Applier, ApplierError, ReloadMsg};
pub use jsrt::JsRuntime;
