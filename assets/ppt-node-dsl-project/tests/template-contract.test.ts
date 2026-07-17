import assert from "node:assert/strict";
import test from "node:test";
import { assertRuntimeManifestComplete } from "../src/template-contract.js";
import type { TemplateManifest } from "../src/types.js";

test("rejects a lossy matching manifest before generation", () => {
  const manifest = {
    manifestVersion: 2,
    templateSha256: "sha256",
    slideCount: 1,
    slides: [{ templateId: "slide_001", pageType: "封面页", logic: [], nodes: [], lists: [] }],
  } as unknown as TemplateManifest;

  assert.throws(
    () => assertRuntimeManifestComplete(manifest),
    /slide_001 缺少有效 slideNumber；禁止向 Runtime 传递精简 manifest/,
  );
});

test("accepts a complete compiled runtime manifest", () => {
  const manifest: TemplateManifest = {
    manifestVersion: 2,
    templateSha256: "sha256",
    sourceTemplate: "template.pptx",
    generatedAt: "2026-07-17T00:00:00Z",
    slideCount: 1,
    slides: [{
      templateId: "slide_001",
      slideNumber: 1,
      slidePath: "ppt/slides/slide1.xml",
      pageType: "封面页",
      logic: [],
      nodes: [{
        key: "text_1",
        kind: "text",
        ordinal: 1,
        rawDsl: "@文本[1-20]",
        sampleContent: "标题",
        locator: { shapeId: "2", shapeName: "@文本[1-20]", nodeType: "sp", path: [0] },
      }],
      lists: [],
      warnings: [],
    }],
  };

  assert.doesNotThrow(() => assertRuntimeManifestComplete(manifest));
});
