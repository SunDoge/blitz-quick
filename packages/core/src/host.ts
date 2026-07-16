// Single source of truth for the host-function contract: the globals Rust
// injects into the QuickJS context before the app boots. Every polyfill/glue
// module in this package relies on these being present at runtime; the
// `declare global` here gives them types project-wide (ambient, no runtime
// emit). Keep this list in sync with `register_*` in crates/blitz-quick/src/jsrt.rs.

export {};

declare global {
  function __bridge_flush(buf: Uint8Array): void;
  function __host_log(s: string): void;
  function __host_log_level(tag: string, msg: string): void;
  function requestAnimationFrame(cb: (t: number) => void): number;
  function __register_timer(id: number, delay: number, repeat: boolean): void;
  function __unregister_timer(id: number): void;
  function __host_utf8_encode(s: string): Uint8Array;
  function __host_utf8_decode(bytes: Uint8Array): string;
  function sysInfo(): string;
  function myCustomFfi(msg: string): string;
  function __resize_observe(solidId: number): void;
  function __resize_unobserve(solidId: number): void;
}
