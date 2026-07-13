import assert from "node:assert/strict";
import test from "node:test";
import { flattenNodes, parseSlideNodes, renameFirstNode, replaceTextInNode } from "../src/pptx/nodes.js";

const xml = `<p:sld><p:cSld><p:spTree><p:grpSp><p:nvGrpSpPr><p:cNvPr id="2" name="@1@1[3-5]"/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="10" y="20"/><a:ext cx="100" cy="200"/></a:xfrm></p:grpSpPr><p:sp><p:nvSpPr><p:cNvPr id="3" name="@文本[2-8]"/></p:nvSpPr><p:txBody><a:p><a:r><a:t>样本文字</a:t></a:r></a:p></p:txBody></p:sp></p:grpSp></p:spTree></p:cSld></p:sld>`;

test("indexes group and child nodes with paths", () => {
  const nodes = flattenNodes(parseSlideNodes(xml));
  assert.equal(nodes.length, 2);
  assert.equal(nodes[0].name, "@1@1[3-5]");
  assert.deepEqual(nodes[0].box, { x: 10, y: 20, cx: 100, cy: 200 });
  assert.deepEqual(nodes[1].path, [0, 0]);
});

test("replaces text while preserving node structure", () => {
  const child = flattenNodes(parseSlideNodes(xml))[1];
  assert.match(replaceTextInNode(child.raw, "新文本"), /<a:t>新文本<\/a:t>/);
  assert.match(renameFirstNode(parseSlideNodes(xml)[0].raw, "@1@2"), /name="@1@2"/);
});

test("removes hidden extra paragraphs and line breaks from atomic text fields", () => {
  const raw = `<p:sp><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>旧值</a:t></a:r></a:p><a:p><a:r><a:t>残留</a:t></a:r></a:p></p:txBody></p:sp>`;
  const updated = replaceTextInNode(raw, "新值");
  assert.equal((updated.match(/<a:p\b/g) ?? []).length, 1);
  assert.match(updated, /<a:t>新值<\/a:t>/);
  assert.doesNotMatch(updated, /残留/);
});
