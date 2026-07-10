import assert from "node:assert/strict";
import test from "node:test";
import { parseDsl } from "../src/dsl/parse.js";

test("parses compact and explicit DSL length ranges", () => {
  const parsed = parseDsl(`
#页面类型
@内容页
#属性
@文本组件-本页标题[4-9]
@列表组件-步骤-长度[3-5]
@列表组件-Item
@@文本组件-这是标题-长度[2-8]
#逻辑关系
@递进关系
`);

  const title = parsed.components.find((component) => component.kind === "text");
  assert.deepEqual(title?.length, { min: 4, max: 9, fixed: false });
  assert.equal(title?.label, "本页标题");
  assert.deepEqual(parsed.lists[0]?.length, { min: 3, max: 5, fixed: false });
  assert.deepEqual(parsed.lists[0]?.itemComponents[0]?.length, { min: 2, max: 8, fixed: false });
  assert.equal(parsed.pageType, "内容页");
});

test("classifies image roles from DSL annotations", () => {
  const parsed = parseDsl(`
#页面类型
@内容页
#属性
@图片组件-内容图-1
@图片组件-装饰图-2
@图片组件-品牌图-3
`);
  const images = parsed.components.filter((component) => component.kind === "image");
  assert.deepEqual(images.map((component) => component.imageRole), ["content", "decorative", "brand"]);
  assert.deepEqual(images.map((component) => component.index), [1, 2, 3]);
});
