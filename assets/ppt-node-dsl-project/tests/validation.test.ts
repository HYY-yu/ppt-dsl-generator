import assert from "node:assert/strict";
import test from "node:test";
import type { ComponentManifest, DeckInput, SlideManifest, TemplateManifest } from "../src/types.js";
import { meaningfulTextLength, validateDeckInput } from "../src/validation.js";

const locator = { shapeId: "1", shapeName: "@文本[2-4]", nodeType: "sp" as const, path: [0] };
const text: ComponentManifest = { key: "text_1", kind: "text", ordinal: 1, rawDsl: "@文本[2-4]", sampleContent: "章节", length: { min: 2, max: 4, fixed: false }, locator };
const number: ComponentManifest = { key: "number_1", kind: "number", ordinal: 1, rawDsl: "@序号-01", sampleContent: "01", numberWidth: 2, locator: { ...locator, shapeId: "2", shapeName: "@序号-01" } };
const base = { slidePath: "ppt/slides/slide1.xml", logic: [], warnings: [] };
const directory: SlideManifest = {
  ...base, templateId: "directory", slideNumber: 1, pageType: "目录页", nodes: [],
  lists: [{ key: "list_1", listIndex: 1, dynamic: true, minItems: 1, maxItems: 5, layout: "row", items: [{ itemIndex: 1, components: [text] }], componentContract: [{ key: "text_1", kind: "text", ordinal: 1, length: text.length }] }],
};
const transition: SlideManifest = { ...base, templateId: "transition", slideNumber: 2, pageType: "章节过渡页", nodes: [text, number], lists: [] };
const manifest: TemplateManifest = { sourceTemplate: "fixture.pptx", generatedAt: "", slideCount: 2, slides: [directory, transition] };

test("requires one transition slide per directory item", async () => {
  const input: DeckInput = {
    slides: [
      { templateId: "directory", lists: { list_1: [{ text_1: "章节" }, { text_1: "行动" }] } },
      { templateId: "transition", nodes: { text_1: "章节", number_1: 1 } },
    ],
  };
  const errors = await validateDeckInput(manifest, input);
  assert.ok(errors.some((error) => error.includes("目录项数 2 必须等于章节过渡页数 1")));
});

test("requires continuous transition numbering", async () => {
  const input: DeckInput = {
    slides: [
      { templateId: "directory", lists: { list_1: [{ text_1: "章节" }] } },
      { templateId: "transition", nodes: { text_1: "章节", number_1: 2 } },
    ],
  };
  const errors = await validateDeckInput(manifest, input);
  assert.ok(errors.some((error) => error.includes("章节序号应为 1")));
});

test("requires core page types and fixed first/last positions", async () => {
  const input: DeckInput = {
    slides: [
      { templateId: "directory", lists: { list_1: [{ text_1: "章节" }] } },
      { templateId: "transition", nodes: { text_1: "章节", number_1: 1 } },
    ],
  };
  const errors = await validateDeckInput(manifest, input);
  assert.ok(errors.includes("整套 Deck 必须至少包含 1 张封面页"));
  assert.ok(errors.includes("整套 Deck 必须至少包含 1 张内容页"));
  assert.ok(errors.includes("整套 Deck 必须至少包含 1 张结尾页"));
  assert.ok(errors.includes("第一张必须是封面页"));
  assert.ok(errors.includes("最后一张必须是结尾页"));
});

test("requires directory before the first transition", async () => {
  const emptySlide = (templateId: string, slideNumber: number, pageType: SlideManifest["pageType"]): SlideManifest => ({
    ...base, templateId, slideNumber, pageType, nodes: [], lists: [],
  });
  const completeManifest: TemplateManifest = {
    ...manifest,
    slideCount: 5,
    slides: [
      emptySlide("cover", 1, "封面页"),
      transition,
      directory,
      emptySlide("content", 4, "内容页"),
      emptySlide("ending", 5, "结尾页"),
    ],
  };
  const input: DeckInput = {
    slides: [
      { templateId: "cover" },
      { templateId: "transition", nodes: { text_1: "章节", number_1: 1 } },
      { templateId: "directory", lists: { list_1: [{ text_1: "章节" }] } },
      { templateId: "content" },
      { templateId: "ending" },
    ],
  };
  const errors = await validateDeckInput(completeManifest, input);
  assert.ok(errors.includes("目录页必须位于第一张章节过渡页之前"));
});

test("rejects invisible Unicode padding in text fields", async () => {
  const input: DeckInput = {
    slides: [
      { templateId: "directory", lists: { list_1: [{ text_1: "章节\u200b\u200d" }] } },
      { templateId: "transition", nodes: { text_1: "章节", number_1: 1 } },
    ],
  };
  const errors = await validateDeckInput(manifest, input);
  assert.ok(errors.some((error) => error.includes("包含不可见格式字符")));
});

test("meaningful text length collapses repeated whitespace", () => {
  assert.deepEqual(meaningfulTextLength("  alpha     beta  "), { length: 10, hasInvalidCharacters: false });
  assert.deepEqual(meaningfulTextLength("内容\u205f\u205f"), { length: 2, hasInvalidCharacters: true });
});
