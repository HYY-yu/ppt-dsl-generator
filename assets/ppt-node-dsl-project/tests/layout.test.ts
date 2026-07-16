import assert from "node:assert/strict";
import test from "node:test";
import type { Box } from "../src/types.js";
import { planDynamicListLayout } from "../src/pptx/layout.js";

const staggered: Box[] = [
  { x: 240632, y: 1222158, cx: 1809719, cy: 2754779 },
  { x: 2725815, y: 3367337, cx: 1809750, cy: 2731527 },
  { x: 5202315, y: 1222158, cx: 1809750, cy: 2754779 },
  { x: 7678815, y: 3367337, cx: 1809750, cy: 2731527 },
  { x: 10155315, y: 1222158, cx: 1809750, cy: 2754779 },
];

test("preserves exact template boxes when dynamic-list item count is unchanged", () => {
  const plan = planDynamicListLayout(staggered, 5, "row");
  assert.equal(plan.mode, "template");
  assert.equal(plan.patternPeriod, 2);
  assert.deepEqual(plan.slots, staggered);
  assert.deepEqual(plan.sourceIndexes, [0, 1, 2, 3, 4]);
});

test("redistributes only the primary axis for a shorter staggered list", () => {
  const plan = planDynamicListLayout(staggered, 4, "row");
  assert.equal(plan.mode, "pattern");
  assert.equal(plan.patternPeriod, 2);
  assert.deepEqual(plan.slots.map((box) => box.y), [1222158, 3367337, 1222158, 3367337]);
  assert.deepEqual(plan.slots.map((box) => box.cy), [2754779, 2731527, 2754779, 2731527]);
  const centers = plan.slots.map((box) => box.x + box.cx / 2);
  assert.equal(centers[0], staggered[0].x + staggered[0].cx / 2);
  assert.equal(centers[3], staggered[4].x + staggered[4].cx / 2);
});

test("repeats the cross-axis prototype when a patterned list expands", () => {
  const plan = planDynamicListLayout(staggered.slice(0, 2), 5, "row");
  assert.equal(plan.mode, "pattern");
  assert.equal(plan.patternPeriod, 2);
  assert.deepEqual(plan.sourceIndexes, [0, 1, 0, 1, 0]);
  assert.deepEqual(plan.slots.map((box) => box.y), [1222158, 3367337, 1222158, 3367337, 1222158]);
});

test("keeps the existing uniform algorithm for a resized single-row list", () => {
  const boxes: Box[] = [
    { x: 0, y: 100, cx: 100, cy: 200 },
    { x: 150, y: 100, cx: 100, cy: 200 },
    { x: 300, y: 100, cx: 100, cy: 200 },
  ];
  const plan = planDynamicListLayout(boxes, 2, "row");
  assert.equal(plan.mode, "uniform");
  assert.deepEqual(plan.slots.map((box) => box.y), [100, 100]);
  assert.deepEqual(plan.slots.map((box) => box.cy), [200, 200]);
});

test("preserves a left-right pattern for a column layout", () => {
  const boxes: Box[] = [
    { x: 100, y: 0, cx: 200, cy: 100 },
    { x: 400, y: 150, cx: 220, cy: 100 },
    { x: 100, y: 300, cx: 200, cy: 100 },
  ];
  const plan = planDynamicListLayout(boxes, 2, "column");
  assert.equal(plan.mode, "pattern");
  assert.deepEqual(plan.slots.map((box) => box.x), [100, 400]);
  assert.deepEqual(plan.slots.map((box) => box.cx), [200, 220]);
});
