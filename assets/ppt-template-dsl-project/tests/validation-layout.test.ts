import assert from "node:assert/strict";
import test from "node:test";
import { expandOverflowSlides } from "../src/pptx/layout.js";
import type { DeckInput, DslComponent, SlideManifest, TemplateManifest } from "../src/types.js";
import { validateDeckInput } from "../src/validation.js";

const titleComponent: DslComponent = {
  scope: "slide",
  raw: "@文本组件-本页标题[4-12]",
  kind: "text",
  label: "本页标题",
  length: { min: 4, max: 12, fixed: false },
};
const itemComponent: DslComponent = {
  scope: "listItem",
  raw: "@@文本组件-标题[2-8]",
  kind: "text",
  label: "标题",
  length: { min: 2, max: 8, fixed: false },
};

const contentSlide: SlideManifest = {
  templateId: "content",
  slideNumber: 4,
  slidePath: "ppt/slides/slide4.xml",
  pageType: "内容页",
  logic: ["并列"],
  fields: [{
    key: "本页标题",
    component: titleComponent,
    targets: [{ slidePath: "ppt/slides/slide4.xml", shapeIndex: 0, placeholder: "本页标题", occurrence: 0, text: "本页标题" }],
  }],
  lists: [{
    key: "列表_1_步骤",
    component: {
      scope: "slide",
      raw: "@列表组件-步骤-长度[3-5]",
      kind: "list",
      label: "步骤",
      length: { min: 3, max: 5, fixed: false },
      itemComponents: [itemComponent],
    },
    maxItemsInTemplate: 5,
    itemFields: [{
      key: "标题",
      component: itemComponent,
      targets: Array.from({ length: 5 }, (_, index) => ({
        slidePath: "ppt/slides/slide4.xml",
        shapeIndex: index + 1,
        placeholder: "标题",
        occurrence: index,
        text: "标题",
      })),
    }],
  }],
  images: [],
  warnings: [],
};

const simpleSlide = (templateId: string, pageType: string, number: number): SlideManifest => ({
  templateId,
  slideNumber: number,
  slidePath: `ppt/slides/slide${number}.xml`,
  pageType,
  logic: [],
  fields: [],
  lists: [],
  images: [],
  warnings: [],
});

const manifest: TemplateManifest = {
  sourceTemplate: "fixture.pptx",
  generatedAt: "2026-07-10T00:00:00.000Z",
  slideCount: 5,
  slides: [
    simpleSlide("cover", "封面页", 1),
    simpleSlide("toc", "目录页", 2),
    simpleSlide("transition", "章节过渡页", 3),
    contentSlide,
    simpleSlide("ending", "结尾页", 5),
  ],
};

function inputWithItems(count: number): DeckInput {
  return {
    slides: [
      { templateId: "cover" },
      { templateId: "toc" },
      { templateId: "transition" },
      {
        templateId: "content",
        fields: { 本页标题: `${han(count)}项计划` },
        lists: { 列表_1_步骤: Array.from({ length: count }, (_, index) => ({ 标题: `条目${index + 1}` })) },
      },
      { templateId: "ending" },
    ],
  };
}

test("raw validation accepts safely pageable lists and expanded validation stays consistent", async () => {
  const input = inputWithItems(8);
  const raw = await validateDeckInput(manifest, input, "raw");
  assert.deepEqual(raw.errors, []);
  assert.equal(raw.warnings.length, 1);

  const expanded = { ...input, slides: expandOverflowSlides(manifest, input.slides) };
  assert.equal(expanded.slides.length, 6);
  assert.deepEqual(expanded.slides.slice(3, 5).map((slide) => slide.lists?.列表_1_步骤.length), [4, 4]);
  assert.deepEqual(expanded.slides.slice(3, 5).map((slide) => slide.fields?.本页标题), ["四项计划（1/2）", "四项计划（2/2）"]);
  const result = await validateDeckInput(manifest, expanded, "expanded");
  assert.deepEqual(result.errors, []);
});

test("balanced pagination does not create a final page below DSL min", () => {
  const input = inputWithItems(11);
  const expanded = expandOverflowSlides(manifest, input.slides);
  assert.deepEqual(expanded.slice(3, 6).map((slide) => slide.lists?.列表_1_步骤.length), [4, 4, 3]);
});

test("required field and list bindings cannot be omitted", async () => {
  const input = inputWithItems(4);
  input.slides[3] = { templateId: "content" };
  const result = await validateDeckInput(manifest, input, "raw");
  assert.ok(result.errors.some((error) => error.includes("missing required field 本页标题")));
  assert.ok(result.errors.some((error) => error.includes("missing required list 列表_1_步骤")));
});

test("count-based titles must match visible list nodes", async () => {
  const input = inputWithItems(4);
  input.slides[3]!.fields = { 本页标题: "五项计划" };
  const result = await validateDeckInput(manifest, input, "raw");
  assert.ok(result.errors.some((error) => error.includes("title says 5 items")));
});

test("content images require a binding or explicit approval and source refs stay well-formed", async () => {
  const imageManifest: TemplateManifest = {
    ...manifest,
    slides: manifest.slides.map((slide) => slide.templateId === "content" ? {
      ...slide,
      images: [{
        key: "图片1",
        role: "content",
        slidePath: slide.slidePath,
        picIndex: 0,
      }],
    } : slide),
  };
  const input = inputWithItems(4);
  let result = await validateDeckInput(imageManifest, input, "raw");
  assert.ok(result.errors.some((error) => error.includes("template image 图片1 must be replaced")));

  input.slides[3]!.approvedTemplateImages = ["图片1"];
  input.slides[3]!.sourceRefs = ["report.md#growth-plan"];
  result = await validateDeckInput(imageManifest, input, "raw");
  assert.deepEqual(result.errors, []);

  input.slides[3]!.sourceRefs = [""];
  result = await validateDeckInput(imageManifest, input, "raw");
  assert.ok(result.errors.some((error) => error.includes("sourceRefs[0]")));
});

function han(value: number): string {
  return new Map([[8, "八"], [11, "十一"]]).get(value) ?? String(value);
}
