import assert from "node:assert/strict";
import test from "node:test";
import type { ComponentManifest, DeckInput, SlideManifest, TemplateManifest } from "../src/types.js";
import { meaningfulTextLength, validateDeckContent, validateDeckInput } from "../src/validation.js";

const locator = { shapeId: "1", shapeName: "@文本[2-4]", nodeType: "sp" as const, path: [0] };
const text: ComponentManifest = { key: "text_1", kind: "text", ordinal: 1, rawDsl: "@文本[2-4]", sampleContent: "章节", length: { min: 2, max: 4, fixed: false }, locator };
const number: ComponentManifest = { key: "number_1", kind: "number", ordinal: 1, rawDsl: "@序号-01", sampleContent: "01", numberWidth: 2, locator: { ...locator, shapeId: "2", shapeName: "@序号-01" } };
const base = { slidePath: "ppt/slides/slide1.xml", logic: [], warnings: [] };
const directory: SlideManifest = {
  ...base, templateId: "directory", slideNumber: 1, pageType: "目录页", nodes: [],
  lists: [{ key: "list_1", listIndex: 1, dynamic: true, minItems: 1, maxItems: 5, layout: "row", items: [{ itemIndex: 1, components: [text] }], componentContract: [{ key: "text_1", kind: "text", ordinal: 1, sampleContent: text.sampleContent, length: text.length }] }],
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
  assert.ok(errors.includes("第二张必须是目录页"));
});

test("requires exactly one second-page directory and three to six chapters", async () => {
  const emptySlide = (templateId: string, slideNumber: number, pageType: SlideManifest["pageType"]): SlideManifest => ({
    ...base, templateId, slideNumber, pageType, nodes: [], lists: [],
  });
  const completeManifest: TemplateManifest = {
    ...manifest,
    slideCount: 5,
    slides: [
      emptySlide("cover", 1, "封面页"),
      directory,
      transition,
      emptySlide("content", 4, "内容页"),
      emptySlide("ending", 5, "结尾页"),
    ],
  };
  const input: DeckInput = {
    slides: [
      { templateId: "cover" },
      { templateId: "directory", lists: { list_1: [{ text_1: "章节" }] } },
      { templateId: "transition", nodes: { text_1: "章节", number_1: 1 } },
      { templateId: "content" },
      { templateId: "ending" },
    ],
  };

  const errors = await validateDeckInput(completeManifest, input);
  assert.ok(errors.includes("章节数量必须在 3-6，实际 1"));
});

test("requires at least one content slide after every transition", async () => {
  const emptySlide = (templateId: string, slideNumber: number, pageType: SlideManifest["pageType"]): SlideManifest => ({
    ...base, templateId, slideNumber, pageType, nodes: [], lists: [],
  });
  const completeManifest: TemplateManifest = {
    ...manifest,
    slideCount: 5,
    slides: [
      emptySlide("cover", 1, "封面页"),
      directory,
      transition,
      emptySlide("content", 4, "内容页"),
      emptySlide("ending", 5, "结尾页"),
    ],
  };
  const input: DeckInput = {
    slides: [
      { templateId: "cover" },
      { templateId: "directory", lists: { list_1: [{ text_1: "章节" }, { text_1: "行动" }] } },
      { templateId: "transition", nodes: { text_1: "章节", number_1: 1 } },
      { templateId: "transition", nodes: { text_1: "行动", number_1: 2 } },
      { templateId: "content" },
      { templateId: "ending" },
    ],
  };

  const errors = await validateDeckInput(completeManifest, input);
  assert.ok(errors.includes("第 1 个章节过渡页后没有内容页"));
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

test("content validation allows missing deterministic numbers and rejects non-text output", async () => {
  const contentInput: DeckInput = {
    slides: [
      { templateId: "directory", lists: { list_1: [{ text_1: "章节" }] } },
      { templateId: "transition", nodes: { text_1: "章节" } },
    ],
  };
  const contentErrors = await validateDeckContent(manifest, contentInput);
  assert.ok(!contentErrors.some((error) => error.includes("number_1")));

  contentInput.slides[1].nodes!.number_1 = 1;
  const nonTextErrors = await validateDeckContent(manifest, contentInput);
  assert.ok(nonTextErrors.some((error) => error.includes("nodes 不允许字段: number_1")));
});

test("rejects rich text in short fields", async () => {
  const input: DeckInput = {
    slides: [
      { templateId: "directory", lists: { list_1: [{ text_1: { paragraphs: [{ list: "none", runs: [{ text: "章节", bold: true, underline: false }] }] } }] } },
      { templateId: "transition", nodes: { text_1: "章节", number_1: 1 } },
    ],
  };
  const errors = await validateDeckInput(manifest, input);
  assert.ok(errors.some((error) => error.includes("富文本仅允许用于 maxLength >= 40")));
});

test("validates long rich text by visible text and rejects line breaks inside runs", async () => {
  const longText: ComponentManifest = {
    ...text,
    rawDsl: "@文本[2-120]",
    sampleContent: "包含关键结论和行动建议的长文本",
    length: { min: 2, max: 120, fixed: false },
  };
  const longManifest: TemplateManifest = {
    ...manifest,
    slides: [
      {
        ...directory,
        lists: [{ ...directory.lists[0], items: [{ itemIndex: 1, components: [longText] }], componentContract: [{ key: "text_1", kind: "text", ordinal: 1, sampleContent: longText.sampleContent, length: longText.length }] }],
      },
      { ...transition, nodes: [longText, number] },
    ],
  };
  const rich = {
    paragraphs: [
      { list: "none" as const, runs: [{ text: "核心结论", bold: true, underline: false }, { text: "清晰可执行", bold: false, underline: false }] },
      { list: "bullet" as const, runs: [{ text: "优先修复激活路径", bold: false, underline: true }] },
    ],
  };
  const input: DeckInput = {
    slides: [
      { templateId: "directory", lists: { list_1: [{ text_1: rich }] } },
      { templateId: "transition", nodes: { text_1: rich, number_1: 1 } },
    ],
  };
  const errors = await validateDeckInput(longManifest, input);
  assert.ok(!errors.some((error) => error.includes("富文本") || error.includes("长度") || error.includes("paragraphs")));

  rich.paragraphs[0].runs[0].text = "核心\n结论";
  const malformed = await validateDeckInput(longManifest, input);
  assert.ok(malformed.some((error) => error.includes("请拆成 paragraph")));
});
