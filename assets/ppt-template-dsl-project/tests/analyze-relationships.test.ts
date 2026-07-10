import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import { analyzeTemplate } from "../src/pptx/analyze.js";

test("uses presentation order and follows each slide notes relationship", async () => {
  const zip = new JSZip();
  zip.file("ppt/presentation.xml", `
<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst>
  <p:sldId id="1" r:id="rIdB"/><p:sldId id="2" r:id="rIdA"/>
</p:sldIdLst></p:presentation>`);
  zip.file("ppt/_rels/presentation.xml.rels", `
<Relationships xmlns="rels">
  <Relationship Target="slides/slide2.xml" Type="x/slide" Id="rIdA"/>
  <Relationship Id="rIdB" Type="x/slide" Target="slides/slide9.xml"/>
</Relationships>`);
  zip.file("ppt/slides/slide9.xml", slideXml("封面标题"));
  zip.file("ppt/slides/slide2.xml", slideXml("内容标题"));
  zip.file("ppt/slides/_rels/slide9.xml.rels", `
<Relationships><Relationship Type="x/notesSlide" Target="../notesSlides/notesSlide3.xml" Id="n9"/></Relationships>`);
  zip.file("ppt/slides/_rels/slide2.xml.rels", `
<Relationships><Relationship Id="n2" Target="../notesSlides/notesSlide8.xml" Type="x/notesSlide"/></Relationships>`);
  zip.file("ppt/notesSlides/notesSlide3.xml", notesXml("封面页", "封面标题"));
  zip.file("ppt/notesSlides/notesSlide8.xml", notesXml("内容页", "内容标题"));

  const manifest = await analyzeTemplate(zip, "fixture.pptx");
  assert.deepEqual(manifest.slides.map((slide) => slide.slidePath), ["ppt/slides/slide9.xml", "ppt/slides/slide2.xml"]);
  assert.deepEqual(manifest.slides.map((slide) => slide.pageType), ["封面页", "内容页"]);
  assert.deepEqual(manifest.slides.map((slide) => slide.templateId), ["slide_001", "slide_002"]);
  assert.equal(manifest.slides[0]?.fields[0]?.component.length?.max, 8);
});

function slideXml(text: string): string {
  return `<p:sld><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="1" name="title"/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="100" cy="100"/></a:xfrm></p:spPr><p:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
}

function notesXml(pageType: string, field: string): string {
  return `<p:notes><a:t>#页面类型</a:t><a:t>@${pageType}</a:t><a:t>#属性</a:t><a:t>@文本组件-${field}[2-8]</a:t><a:t>#逻辑关系</a:t></p:notes>`;
}
