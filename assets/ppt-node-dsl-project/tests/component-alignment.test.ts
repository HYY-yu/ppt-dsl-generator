import assert from "node:assert/strict";
import test from "node:test";
import { analyzeTemplate } from "../src/pptx/analyze.js";
import { readPptx } from "../src/pptx/read.js";

test("aligns repeated same-kind fields when later XML order differs", async () => {
  const fixture = process.env.NODE_DSL_TEMPLATE_FIXTURE;
  if (!fixture) return;
  const manifest = await analyzeTemplate(await readPptx(fixture), fixture);
  const list = manifest.slides.find((slide) => slide.templateId === "slide_015")?.lists[0];
  assert.ok(list);
  assert.equal(list.items[2].components.find((component) => component.key === "text_1")?.locator.shapeId, "17");
  assert.equal(list.items[2].components.find((component) => component.key === "text_3")?.locator.shapeId, "31");
});
