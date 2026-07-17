import assert from "node:assert/strict";
import test from "node:test";
import { bindDeterministicNumbers, formatDeterministicNumber } from "../src/deck-numbers.js";
import type { DeckInput, TemplateManifest } from "../src/types.js";

const locator = (shapeId: string) => ({ shapeId, shapeName: "@序号-001", nodeType: "sp" as const, path: [0] });
const manifest: TemplateManifest = {
  sourceTemplate: "fixture.pptx",
  generatedAt: "",
  slideCount: 1,
  slides: [{
    templateId: "transition",
    slideNumber: 1,
    slidePath: "ppt/slides/slide1.xml",
    pageType: "章节过渡页",
    logic: [],
    nodes: [{ key: "number_1", kind: "number", ordinal: 1, rawDsl: "@序号-001", sampleContent: "001", numberWidth: 3, locator: locator("2") }],
    lists: [],
    warnings: [],
  }],
};

test("binds transition numbers without mutating the input", () => {
  const input: DeckInput = { slides: [{ templateId: "transition", nodes: { number_1: 99 } }] };
  const bound = bindDeterministicNumbers(manifest, input);
  assert.equal(bound.slides[0].nodes?.number_1, 1);
  assert.equal(input.slides[0].nodes?.number_1, 99);
});

test("formats deterministic ordinals with the template width", () => {
  assert.deepEqual([1, 2, 3].map((value) => formatDeterministicNumber(value, 1)), ["1", "2", "3"]);
  assert.deepEqual([1, 2, 3].map((value) => formatDeterministicNumber(value, 2)), ["01", "02", "03"]);
  assert.deepEqual([1, 2, 3].map((value) => formatDeterministicNumber(value, 3)), ["001", "002", "003"]);
});
