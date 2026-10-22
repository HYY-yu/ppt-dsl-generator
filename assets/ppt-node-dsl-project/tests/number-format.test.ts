import assert from "node:assert/strict";
import test from "node:test";
import { formatNumber } from "../src/pptx/generate.js";

test("formats deterministic integer ordinals with the template number width", () => {
  assert.deepEqual([1, 2, 3].map((value) => formatNumber(value, 1)), ["1", "2", "3"]);
  assert.deepEqual([1, 2, 3].map((value) => formatNumber(value, 2)), ["01", "02", "03"]);
  assert.deepEqual([1, 2, 3].map((value) => formatNumber(value, 3)), ["001", "002", "003"]);
});
