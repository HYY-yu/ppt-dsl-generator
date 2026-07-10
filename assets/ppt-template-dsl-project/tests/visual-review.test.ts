import assert from "node:assert/strict";
import test from "node:test";
import { buildVisualReviewTemplate, validateVisualReview } from "../src/qa/visual-review.js";

test("visual review requires every slide and every check to be resolved", () => {
  const review = buildVisualReviewTemplate(2);
  assert.ok(validateVisualReview(review, 2).some((error) => error.includes("status must be pass")));

  for (const slide of review.slides) {
    slide.status = "pass";
    for (const check of Object.keys(slide.checks) as Array<keyof typeof slide.checks>) slide.checks[check] = check === "imageCrop" ? "na" : "pass";
  }
  assert.deepEqual(validateVisualReview(review, 2), []);
});
