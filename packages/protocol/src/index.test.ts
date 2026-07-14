import { describe, expect, test } from "bun:test";
import { Writer } from "./index";

describe("Writer limits", () => {
  test("rejects strings that cannot be represented by the wire format", () => {
    const writer = new Writer();

    expect(() => writer.createText(1, "x".repeat(0x10000))).toThrow(
      "maximum is 65535",
    );
  });
});
