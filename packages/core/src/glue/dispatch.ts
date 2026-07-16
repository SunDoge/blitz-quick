// __dispatchEvent host glue. Rust calls this to forward a DOM event into the
// SolidJS handler tree. It's a thin passthrough to the solid-renderer's
// `dispatchEvent`, which handles bubbling + listener lookup.

import { dispatchEvent } from "@blitz-quick/solid-renderer";

function __dispatchEvent(
  solidId: number,
  eventCode: number,
  payload: string,
): void {
  dispatchEvent(solidId, eventCode, payload);
}

(globalThis as unknown as Record<string, unknown>).__dispatchEvent =
  __dispatchEvent;
