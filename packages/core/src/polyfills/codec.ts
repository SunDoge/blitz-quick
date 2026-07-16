export {};

// TextEncoder / TextDecoder / structuredClone. TextEncoder+Decoder are backed
// by the host UTF-8 codec (`__host_utf8_encode`/`__host_utf8_decode`);
// structuredClone is a pure-JS deep copy.

if (
  typeof TextEncoder === "undefined" &&
  typeof __host_utf8_encode !== "undefined"
) {
  class TextEncoderPolyfill {
    encode(s: string): Uint8Array {
      return __host_utf8_encode(s);
    }
  }
  (globalThis as any).TextEncoder = TextEncoderPolyfill;
}

if (
  typeof TextDecoder === "undefined" &&
  typeof __host_utf8_decode !== "undefined"
) {
  // Minimal TextDecoder: UTF-8 only (the only encoding the host fn supports),
  // non-fatal by default (invalid bytes become U+FFFD, matching the spec's
  // default `fatal: false`). The `fatal` option is honored by re-checking.
  class TextDecoderPolyfill {
    private fatal: boolean;
    constructor(label?: string, options?: { fatal?: boolean }) {
      // Label is ignored — we only speak UTF-8.
      this.fatal = options?.fatal ?? false;
    }
    decode(bytes: Uint8Array): string {
      const s = __host_utf8_decode(bytes);
      if (this.fatal) {
        // Round-trip check: re-encode and compare. U+FFFD from lossy decode
        // only appears when input was invalid, so a mismatch means the bytes
        // weren't valid UTF-8.
        const re = __host_utf8_encode(s);
        if (re.length !== bytes.length || !re.every((b, i) => b === bytes[i])) {
          throw new TypeError("The encoded data was not valid UTF-8");
        }
      }
      return s;
    }
  }
  (globalThis as any).TextDecoder = TextDecoderPolyfill;
}

// structuredClone — backed by the `structured-clone` package (a pure-JS
// implementation of the structured clone algorithm) instead of a hand-rolled
// recursive cloner.
if (typeof structuredClone === "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { clone } = require("structured-clone");
  (globalThis as any).structuredClone = clone;
}
