import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import { analyzeTemplate } from "../src/pptx/analyze.js";

test("treats Group list without a range as fixed length", async () => {
  const manifest = await analyzeTemplate(buildTemplate(["@1@1", "@1@2", "@1@3"]), "fixture.pptx");
  const slide = manifest.slides[0];
  const list = slide.lists[0];

  assert.ok(list);
  assert.equal(list.dynamic, true);
  assert.equal(list.minItems, 3);
  assert.equal(list.maxItems, 3);
  assert.deepEqual(slide.warnings, []);
});

test("keeps declared Group list range and rejects a range on later groups", async () => {
  const manifest = await analyzeTemplate(buildTemplate(["@1@1[2-4]", "@1@2[2-4]"]), "fixture.pptx");
  const slide = manifest.slides[0];
  const list = slide.lists[0];

  assert.equal(list.minItems, 2);
  assert.equal(list.maxItems, 4);
  assert.ok(slide.warnings.some((warning) => warning.includes("只有第一组可以声明范围")));
});

function buildTemplate(groupNames: string[]): JSZip {
  const zip = new JSZip();
  zip.file("ppt/presentation.xml", `
    <p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
      <p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst>
    </p:presentation>`);
  zip.file("ppt/_rels/presentation.xml.rels", `
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
    </Relationships>`);
  zip.file("ppt/slides/slide1.xml", `
    <p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
      <p:cSld><p:spTree>${groupNames.map(groupXml).join("")}</p:spTree></p:cSld>
    </p:sld>`);
  zip.file("ppt/slides/_rels/slide1.xml.rels", `
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide1.xml"/>
    </Relationships>`);
  zip.file("ppt/notesSlides/notesSlide1.xml", `<p:notes xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:t>@内容页</a:t></p:notes>`);
  return zip;
}

function groupXml(name: string, index: number): string {
  const groupId = index * 2 + 2;
  const textId = groupId + 1;
  return `
    <p:grpSp>
      <p:nvGrpSpPr><p:cNvPr id="${groupId}" name="${name}"/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="${index * 100}" y="0"/><a:ext cx="80" cy="40"/></a:xfrm></p:grpSpPr>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="${textId}" name="${index === 0 ? "@文本[1-20]" : "@文本"}"/></p:nvSpPr>
        <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="80" cy="40"/></a:xfrm></p:spPr>
        <p:txBody><a:p><a:r><a:t>示例</a:t></a:r></a:p></p:txBody>
      </p:sp>
    </p:grpSp>`;
}
