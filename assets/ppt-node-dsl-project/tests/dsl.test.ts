import assert from "node:assert/strict";
import test from "node:test";
import { normalizeDslName, parseComponentName, parseFixedListComponentName, parseGroupName, parseNotes } from "../src/dsl/parse.js";

test("parses dynamic list group names", () => {
  assert.deepEqual(parseGroupName(" @1@1[3-5] "), {
    raw: " @1@1[3-5] ", listIndex: 1, itemIndex: 1, range: { min: 3, max: 5, fixed: false },
  });
  assert.deepEqual(parseGroupName("@1@2"), { raw: "@1@2", listIndex: 1, itemIndex: 2, range: undefined });
});

test("parses simple components inside a group", () => {
  assert.equal(parseComponentName("@ 文本[4-10]")?.kind, "text");
  assert.equal(parseComponentName("@文本框[4-10]")?.kind, "text");
  assert.equal(parseComponentName("@图片-3")?.imageIndex, 3);
  assert.equal(parseComponentName("@序号-01")?.numberWidth, 2);
  assert.equal(parseComponentName("@图标")?.kind, "icon");
});

test("parses fixed list components without confusing group names", () => {
  assert.equal(parseFixedListComponentName("@2@3 文本")?.itemIndex, 3);
  assert.equal(parseFixedListComponentName("@1@1[3-5]"), undefined);
});

test("rejects malformed text ranges", () => {
  assert.equal(parseComponentName("@文本4-30]"), undefined);
});

test("parses page notes only as page metadata", () => {
  assert.deepEqual(parseNotes("#页面类型\n@内容页\n#逻辑关系\n@总分关系"), { pageType: "内容页", logic: ["总分关系"] });
  assert.equal(normalizeDslName("＠ 文本  [4-10]"), "@文本 [4-10]");
});
