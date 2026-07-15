import { expect, test } from "bun:test";
import { createElement, dispatchEvent, EVENT_CODE, setProp } from "./index";

test("input listeners receive a DOM-like currentTarget", () => {
  const input = createElement("input");
  let currentTarget: { id: number; value: string } | undefined;
  setProp(
    input,
    "onInput",
    (event: { currentTarget: { id: number; value: string } }) => {
      currentTarget = event.currentTarget;
    },
    undefined,
  );

  dispatchEvent(
    input.id,
    EVENT_CODE.input,
    JSON.stringify({ value: "typed text" }),
  );

  expect(currentTarget).toEqual({ id: input.id, value: "typed text" });
});
