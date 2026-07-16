// @blitz-quick/core — installs the Web-API surface the host (Rust) doesn't
// provide natively. Importing this package for side effects is enough: each
// module below self-installs onto globalThis. The host fn contract lives in
// `./host` (ambient `declare global`); runtime host fns are injected by
// crates/blitz-quick/src/jsrt.rs before the app boots.
//
// Load order matters only where a later module relies on an earlier one's
// global (e.g. the lazy TextEncoder in @blitz-quick/protocol, resolved on
// first use well after this init). Polyfills that need no host fn can go in
// any order; glue modules import from @blitz-quick/solid-renderer directly.

import "./host";

import "./polyfills/url";
import "./polyfills/codec";
import "./polyfills/console";
import "./polyfills/dom-globals";
import "./polyfills/fetch";

import "./glue/animation-frame";
import "./glue/dispatch";
import "./glue/timers";
import "./glue/resize-observer";

export {};
