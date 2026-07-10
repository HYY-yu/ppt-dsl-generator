import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import { inspectPptxPackage } from "../src/pptx/package-qa.js";

test("package QA rejects empty and sample-text structural placeholders", async () => {
  const zip = new JSZip();
  zip.file("ppt/presentation.xml", '<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst><p:sldId r:id="rId1"/></p:sldIdLst></p:presentation>');
  zip.file("ppt/_rels/presentation.xml.rels", '<Relationships><Relationship Id="rId1" Target="slides/slide1.xml" Type="x/slide"/></Relationships>');
  zip.file("ppt/slides/slide1.xml", '<p:sld><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="1" name="Title"/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:txBody><a:p/></p:txBody></p:sp><p:sp><p:nvSpPr><p:cNvPr id="2" name="Footer"/><p:nvPr><p:ph type="ftr"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>Footer</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>');
  zip.file("ppt/slides/_rels/slide1.xml.rels", "<Relationships/>");

  const result = await inspectPptxPackage(zip);
  assert.equal(result.emptyPlaceholders.length, 1);
  assert.equal(result.placeholderSampleTexts.length, 1);
  assert.ok(result.errors.some((error) => error.includes("empty structural placeholders")));
});
