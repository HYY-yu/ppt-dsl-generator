import assert from "node:assert/strict";
import test from "node:test";
import { selectCandidates, type CandidateRequest } from "../src/select.js";
import type { ComponentKind, ComponentManifest, ListManifest, SlideManifest, TemplateManifest } from "../src/types.js";

function component(kind: ComponentKind): ComponentManifest {
  return {
    key: kind, kind, ordinal: 1, rawDsl: "", sampleContent: "",
    locator: { shapeId: "1", shapeName: kind, nodeType: "sp", path: [0] },
  };
}

function list(key: string, minItems = 1, maxItems = 3, kind: ComponentKind = "text"): ListManifest {
  return {
    key, listIndex: 1, dynamic: true, minItems, maxItems, layout: "column",
    items: Array.from({ length: maxItems }, (_, i) => ({ itemIndex: i + 1, components: [component(kind)] })),
    componentContract: [{ key: kind, kind, ordinal: 1, sampleContent: "" }],
  };
}

function slide(templateId: string, overrides: Partial<SlideManifest> = {}): SlideManifest {
  return {
    templateId, slideNumber: 1, slidePath: "ppt/slides/slide1.xml", pageType: "内容页",
    logic: [], nodes: [], lists: [], warnings: [], ...overrides,
  };
}

function manifest(slides: SlideManifest[]): TemplateManifest {
  return { manifestVersion: 2, sourceTemplate: "synthetic.pptx", generatedAt: "2026-01-01T00:00:00Z", slideCount: slides.length, slides };
}

function request(overrides: Partial<CandidateRequest> = {}): CandidateRequest {
  return { pageType: "内容页", availableAssetKinds: [], ...overrides };
}

function ids(input: TemplateManifest, query: CandidateRequest): string[] {
  return selectCandidates(input, query).map(candidate => candidate.templateId);
}

test("page role is a hard filter even when the wrong role has better logic", () => {
  const input = manifest([
    slide("cover", { pageType: "封面页", logic: ["compare"] }),
    slide("content", { logic: ["sequence"] }),
    slide("contents", { pageType: "目录页" }),
    slide("section", { pageType: "章节过渡页" }),
    slide("closing", { pageType: "结尾页" }),
  ]);
  assert.deepEqual(ids(input, request({ logic: ["compare"] })), ["content"]);
  for (const [pageType, expected] of [
    ["封面页", "cover"], ["目录页", "contents"], ["章节过渡页", "section"], ["结尾页", "closing"],
  ] as const) assert.deepEqual(ids(input, request({ pageType })), [expected]);
  assert.deepEqual(ids(manifest([slide("cover", { pageType: "封面页" })]), request()), []);
});

for (const [label, count, expected] of [
  ["minimum", 1, ["bounded"]], ["maximum", 3, ["bounded"]], ["interior", 2, ["bounded"]],
  ["below minimum", 0, []], ["above maximum", 4, []], ["negative", -1, []],
  ["fraction", 1.5, []], ["NaN", NaN, []], ["positive infinity", Infinity, []], ["negative infinity", -Infinity, []],
] as const) {
  test(`list counts enforce ${label}`, () => {
    assert.deepEqual(ids(manifest([slide("bounded", { lists: [list("items")] })]), request({ listCounts: { items: count } })), expected);
  });
}

test("zero is accepted only by a list whose minimum permits it", () => {
  assert.deepEqual(ids(manifest([
    slide("optional", { lists: [list("items", 0, 3)] }),
    slide("required", { lists: [list("items", 1, 3)] }),
  ]), request({ listCounts: { items: 0 } })), ["optional"]);
});

test("unknown list keys reject candidates and every requested count must fit", () => {
  const input = manifest([slide("two-lists", { lists: [list("left"), list("right", 2, 4)] })]);
  assert.deepEqual(ids(input, request({ listCounts: { unknown: 1 } })), []);
  assert.deepEqual(ids(input, request({ listCounts: { left: 1, right: 1 } })), []);
  assert.deepEqual(ids(input, request({ listCounts: { left: 1, right: 4 } })), ["two-lists"]);
  assert.deepEqual(ids(input, request()), ["two-lists"]);
});

for (const kind of ["image", "background", "icon"] as const) {
  for (const location of ["nodes", "list contract"] as const) {
    test(`${kind} in ${location} requires that exact available asset kind`, () => {
      const candidate = slide("asset", location === "nodes"
        ? { nodes: [component(kind)] }
        : { lists: [list("items", 1, 3, kind)] });
      const input = manifest([candidate, slide("plain")]);
      assert.deepEqual(ids(input, request()), ["plain"]);
      assert.deepEqual(ids(input, request({ availableAssetKinds: ["image", "background", "icon"].filter(value => value !== kind) as ComponentKind[] })), ["plain"]);
      assert.deepEqual(ids(input, request({ availableAssetKinds: [kind] })), ["asset", "plain"]);
    });
  }
}

test("all top-level and list asset requirements must be available together", () => {
  const input = manifest([slide("mixed", {
    nodes: [component("image")], lists: [list("backgrounds", 1, 3, "background"), list("icons", 1, 3, "icon")],
  })]);
  assert.deepEqual(ids(input, request({ availableAssetKinds: ["image", "background"] })), []);
  assert.deepEqual(ids(input, request({ availableAssetKinds: ["image", "background", "icon"] })), ["mixed"]);
});

test("non-asset components do not require available asset kinds", () => {
  const kinds: ComponentKind[] = ["text", "number", "table", "chart"];
  const input = manifest([slide("data", { nodes: kinds.map(component), lists: kinds.map(kind => list(kind, 1, 3, kind)) })]);
  assert.deepEqual(ids(input, request()), ["data"]);
});

test("ordered logic match precedes capacity, reuse and template ID", () => {
  const input = manifest([
    slide("a-reversed", { logic: ["detail", "overview"], lists: [list("items", 1, 1)] }),
    slide("z-exact", { logic: ["overview", "detail"], lists: [list("items", 1, 5)] }),
    slide("b-partial", { logic: ["overview"], lists: [list("items", 1, 1)] }),
  ]);
  assert.deepEqual(ids(input, request({ logic: ["overview", "detail"], listCounts: { items: 1 }, usedTemplateIds: ["z-exact", "z-exact"] })), ["z-exact", "b-partial", "a-reversed"]);
});

test("total requested-list capacity slack precedes reuse and template ID", () => {
  const input = manifest([
    slide("a-loose", { lists: [list("left", 1, 2), list("right", 1, 5)] }),
    slide("z-tight", { lists: [list("left", 1, 3), list("right", 1, 2), list("unrequested", 1, 20)] }),
  ]);
  assert.deepEqual(ids(input, request({ listCounts: { left: 1, right: 1 }, usedTemplateIds: ["z-tight", "z-tight"] })), ["z-tight", "a-loose"]);
});

test("reuse counts rank unused, used once and used twice before template ID", () => {
  const input = manifest([slide("a-twice"), slide("m-once"), slide("z-unused")]);
  assert.deepEqual(ids(input, request({ usedTemplateIds: ["a-twice", "m-once", "a-twice", "unrelated"] })), ["z-unused", "m-once", "a-twice"]);
});

test("tied scores use lexicographic template IDs independently of input order", () => {
  const slides = [slide("template-2"), slide("template-10"), slide("template-1")];
  const expected = ["template-1", "template-10", "template-2"];
  assert.deepEqual(ids(manifest(slides), request()), expected);
  assert.deepEqual(ids(manifest([...slides].reverse()), request()), expected);
});

function deepFreeze(value: object): void {
  for (const child of Object.values(value)) if (child !== null && typeof child === "object") deepFreeze(child);
  Object.freeze(value);
}

test("selection does not mutate manifest or request and repeated calls agree", () => {
  const input = manifest([
    slide("z", { logic: ["overview"], nodes: [component("image")], lists: [list("items")] }),
    slide("a", { logic: ["overview"], lists: [list("items")] }),
  ]);
  const query = request({ listCounts: { items: 2 }, availableAssetKinds: ["image"], logic: ["overview"], usedTemplateIds: ["a"] });
  const beforeInput = structuredClone(input), beforeQuery = structuredClone(query);
  deepFreeze(input);
  deepFreeze(query);
  assert.deepEqual(ids(input, query), ["z", "a"]);
  assert.deepEqual(ids(input, query), ["z", "a"]);
  assert.deepEqual(input, beforeInput);
  assert.deepEqual(query, beforeQuery);
});
