// URL / URLSearchParams. Backed by `url-polyfill` (a pure-JS implementation of
// the WHATWG URL standard) rather than a hand-rolled subset — @solidjs/router
// uses `new URL(...)` and various accessors, and a partial implementation
// risks missing a method it relies on.

import "url-polyfill";
