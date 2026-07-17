import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import { addImageRelationship, normalizeRelationshipIds, regenerateDuplicateCreationIds, removeInvalidAnimationTimelines, removeInvalidPresentationRelationships, removeUnreferencedSlideImageRelationships } from "../src/pptx/generate.js";
import { inspectPptxPackage } from "../src/pptx/package-qa.js";

function buildPackage(): JSZip {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/></Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>`);
  zip.file("ppt/presentation.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/></p:presentation>`);
  zip.file("ppt/_rels/presentation.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="slideLayouts/slideLayout1.xml"/></Relationships>`);
  zip.file("ppt/slides/slide1.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld></p:sld>`);
  zip.file("ppt/slideLayouts/slideLayout1.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld></p:sldLayout>`);
  return zip;
}

function duplicateCreationIdPackage(): JSZip {
  const zip = buildPackage();
  zip.file("ppt/presentation.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldIdLst><p:sldId id="256" r:id="rId1"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst></p:presentation>`);
  zip.file("ppt/_rels/presentation.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/></Relationships>`);
  const slideXml = `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main" xmlns:a16="http://schemas.microsoft.com/office/drawing/2014/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""><a:extLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:ext uri="{FF2B5EF4-FFF2-40B4-BE49-F238E27FC236}"><a16:creationId id="{11111111-1111-1111-1111-111111111111}"/></a:ext></a:extLst></p:cNvPr></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld><p:extLst><p:ext uri="{BB962C8B-B14F-4D97-AF65-F5344CB8AC3E}"><p14:creationId val="123456789"/></p:ext></p:extLst></p:sld>`;
  zip.file("ppt/slides/slide1.xml", slideXml);
  zip.file("ppt/slides/slide2.xml", slideXml);
  return zip;
}

function nonCanonicalRelationshipPackage(): JSZip {
  const zip = buildPackage();
  zip.file("ppt/presentation.xml", `<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId id="256" r:id="rId2-created"/></p:sldIdLst></p:presentation>`);
  zip.file("ppt/_rels/presentation.xml.rels", `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2-created" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>`);
  return zip;
}

function danglingAnimationPackage(): JSZip {
  const zip = buildPackage();
  zip.file("ppt/_rels/presentation.xml.rels", `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>`);
  zip.file("ppt/slides/slide1.xml", `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Shape 2"/></p:nvSpPr></p:sp></p:spTree></p:cSld><p:timing><p:tnLst><p:par><p:cTn><p:childTnLst><p:anim><p:cBhvr><p:tgtEl><p:spTgt spid="3"/></p:tgtEl></p:cBhvr></p:anim></p:childTnLst></p:cTn></p:par></p:tnLst></p:timing></p:sld>`);
  return zip;
}

function partiallyDanglingAnimationPackage(): JSZip {
  const zip = buildPackage();
  zip.file("ppt/_rels/presentation.xml.rels", `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>`);
  zip.file("ppt/slides/slide1.xml", `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Shape 2"/></p:nvSpPr></p:sp></p:spTree></p:cSld><p:timing><p:tnLst><p:par><p:cTn><p:childTnLst><p:par><p:cTn><p:childTnLst><p:anim><p:cBhvr><p:tgtEl><p:spTgt spid="2"/></p:tgtEl></p:cBhvr></p:anim></p:childTnLst></p:cTn></p:par><p:par><p:cTn><p:childTnLst><p:anim><p:cBhvr><p:tgtEl><p:spTgt spid="3"/></p:tgtEl></p:cBhvr></p:anim></p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par></p:tnLst></p:timing></p:sld>`);
  return zip;
}

function sharedImageRelationshipPackage(): JSZip {
  const zip = buildPackage();
  zip.file("ppt/_rels/presentation.xml.rels", `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>`);
  zip.file("ppt/slides/slide1.xml", `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/></p:nvGrpSpPr><p:grpSpPr/><p:pic><p:nvPicPr><p:cNvPr id="2" name="One"/></p:nvPicPr><p:blipFill><a:blip r:embed="rId3"/></p:blipFill></p:pic><p:pic><p:nvPicPr><p:cNvPr id="3" name="Two"/></p:nvPicPr><p:blipFill><a:blip r:embed="rId3"/></p:blipFill></p:pic></p:spTree></p:cSld></p:sld>`);
  zip.file("ppt/slides/_rels/slide1.xml.rels", `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/shared.svg"/><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/unused.svg"/></Relationships>`);
  zip.file("ppt/media/shared.svg", `<svg xmlns="http://www.w3.org/2000/svg"/>`);
  zip.file("ppt/media/unused.svg", `<svg xmlns="http://www.w3.org/2000/svg"/>`);
  return zip;
}

function nativeSvgPackage(withCustomGeometry: boolean): JSZip {
  const zip = buildPackage();
  zip.file("[Content_Types].xml", `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="svg" ContentType="image/svg+xml"/></Types>`);
  zip.file("ppt/_rels/presentation.xml.rels", `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>`);
  const shapeProperties = withCustomGeometry
    ? `<p:spPr><a:custGeom><a:pathLst/></a:custGeom></p:spPr>`
    : `<p:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>`;
  zip.file("ppt/slides/slide1.xml", `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/></p:nvGrpSpPr><p:grpSpPr/><p:pic><p:blipFill><a:blip><a:extLst><a:ext uri="{96DAC541-7B7A-43D3-8B79-37D633B846F1}"><asvg:svgBlip xmlns:asvg="http://schemas.microsoft.com/office/drawing/2016/SVG/main" r:embed="rId2"/></a:ext></a:extLst></a:blip></p:blipFill>${shapeProperties}</p:pic></p:spTree></p:cSld></p:sld>`);
  zip.file("ppt/slides/_rels/slide1.xml.rels", `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/icon.svg"/></Relationships>`);
  zip.file("ppt/media/icon.svg", `<svg xmlns="http://www.w3.org/2000/svg"/>`);
  return zip;
}

test("package QA rejects Presentation -> SlideLayout relationships", async () => {
  const result = await inspectPptxPackage(buildPackage());
  assert.equal(result.invalidPresentationRelationships.length, 1);
  assert.match(result.errors.join("\n"), /invalid Presentation -> SlideLayout relationships: 1/);
});

test("generation cleanup removes only invalid Presentation -> SlideLayout relationships", async () => {
  const zip = buildPackage();
  const removed = await removeInvalidPresentationRelationships(zip);
  assert.equal(removed.count, 1);
  const rels = await zip.file("ppt/_rels/presentation.xml.rels")?.async("string");
  assert.match(rels ?? "", /relationships\/slide"/);
  assert.doesNotMatch(rels ?? "", /relationships\/slideLayout"/);
  const result = await inspectPptxPackage(zip);
  assert.deepEqual(result.invalidPresentationRelationships, []);
  assert.deepEqual(result.errors, []);
});

test("package QA rejects duplicate slide and shape creation IDs", async () => {
  const result = await inspectPptxPackage(duplicateCreationIdPackage());
  assert.equal(result.duplicateSlideCreationIds.length, 1);
  assert.equal(result.duplicateShapeCreationIds.length, 1);
  assert.match(result.errors.join("\n"), /duplicate slide creation IDs: 1/);
  assert.match(result.errors.join("\n"), /duplicate shape creation IDs: 1/);
});

test("generation cleanup regenerates duplicate slide and shape creation IDs", async () => {
  const zip = duplicateCreationIdPackage();
  const regenerated = await regenerateDuplicateCreationIds(zip);
  assert.equal(regenerated.slideCount, 1);
  assert.equal(regenerated.shapeCount, 1);
  const result = await inspectPptxPackage(zip);
  assert.deepEqual(result.duplicateSlideCreationIds, []);
  assert.deepEqual(result.duplicateShapeCreationIds, []);
  assert.deepEqual(result.errors, []);
});

test("package QA rejects non-canonical relationship IDs that PowerPoint repairs", async () => {
  const result = await inspectPptxPackage(nonCanonicalRelationshipPackage());
  assert.deepEqual(result.nonCanonicalRelationshipIds, ["ppt/_rels/presentation.xml.rels: rId2-created"]);
  assert.match(result.errors.join("\n"), /non-canonical relationship IDs: 1/);
});

test("generation cleanup normalizes relationship IDs and owner references", async () => {
  const zip = nonCanonicalRelationshipPackage();
  const normalized = await normalizeRelationshipIds(zip);
  assert.equal(normalized.count, 1);
  const presentation = await zip.file("ppt/presentation.xml")?.async("string");
  const relationships = await zip.file("ppt/_rels/presentation.xml.rels")?.async("string");
  assert.match(presentation ?? "", /r:id="rId2"/);
  assert.match(relationships ?? "", /Id="rId2"/);
  assert.doesNotMatch(`${presentation}${relationships}`, /-created/);
  const result = await inspectPptxPackage(zip);
  assert.deepEqual(result.nonCanonicalRelationshipIds, []);
  assert.deepEqual(result.errors, []);
});

test("package QA rejects animation timelines that target removed shapes", async () => {
  const result = await inspectPptxPackage(danglingAnimationPackage());
  assert.deepEqual(result.invalidAnimationTargets, ["ppt/slides/slide1.xml: spid=3"]);
  assert.match(result.errors.join("\n"), /invalid animation targets: 1/);
});

test("generation cleanup removes timing blocks with dangling animation targets", async () => {
  const zip = danglingAnimationPackage();
  const result = await removeInvalidAnimationTimelines(zip);
  assert.equal(result.count, 1);
  assert.equal(result.prunedBranches, 1);
  assert.equal(result.removedTimelines, 1);
  assert.deepEqual(result.samples, ["ppt/slides/slide1.xml:spid=3:timeline-removed"]);
  const slideXml = await zip.file("ppt/slides/slide1.xml")?.async("string");
  assert.doesNotMatch(slideXml ?? "", /<p:timing\b/);
  const report = await inspectPptxPackage(zip);
  assert.deepEqual(report.invalidAnimationTargets, []);
  assert.deepEqual(report.errors, []);
});

test("generation cleanup prunes only a missing dynamic-list animation branch", async () => {
  const zip = partiallyDanglingAnimationPackage();
  const result = await removeInvalidAnimationTimelines(zip);
  assert.equal(result.count, 1);
  assert.equal(result.prunedBranches, 1);
  assert.equal(result.removedTimelines, 0);
  assert.deepEqual(result.samples, ["ppt/slides/slide1.xml:spid=3:branches-pruned"]);
  const slideXml = await zip.file("ppt/slides/slide1.xml")?.async("string");
  assert.match(slideXml ?? "", /<p:timing\b/);
  assert.match(slideXml ?? "", /spid="2"/);
  assert.doesNotMatch(slideXml ?? "", /spid="3"/);
  const report = await inspectPptxPackage(zip);
  assert.deepEqual(report.invalidAnimationTargets, []);
  assert.deepEqual(report.errors, []);
});

test("package QA rejects image relationships that no slide node references", async () => {
  const result = await inspectPptxPackage(sharedImageRelationshipPackage());
  assert.deepEqual(result.unreferencedImageRelationships, ["ppt/slides/slide1.xml: rId4 -> ../media/unused.svg"]);
  assert.match(result.errors.join("\n"), /unreferenced image relationships: 1/);
});

test("package QA accepts native SVG pictures with clean rectangular geometry", async () => {
  const result = await inspectPptxPackage(nativeSvgPackage(false));
  assert.equal(result.nativeSvgEmbeddings, 1);
  assert.deepEqual(result.invalidSvgEmbeddings, []);
});

test("package QA rejects native SVG pictures that retain template custom geometry", async () => {
  const result = await inspectPptxPackage(nativeSvgPackage(true));
  assert.deepEqual(result.invalidSvgEmbeddings, ["ppt/slides/slide1.xml: native SVG picture must not retain custom geometry"]);
  assert.match(result.errors.join("\n"), /invalid native SVG embeddings: 1/);
});

test("generation allocates independent image relationships and cleans only unused relationships", async () => {
  const zip = sharedImageRelationshipPackage();
  const first = await addImageRelationship(zip, "ppt/slides/slide1.xml", "first.svg");
  const second = await addImageRelationship(zip, "ppt/slides/slide1.xml", "second.svg");
  assert.equal(first, "rId5");
  assert.equal(second, "rId6");
  const slideFile = zip.file("ppt/slides/slide1.xml");
  assert.ok(slideFile);
  const slideXml = (await slideFile.async("string"))
    .replace('r:embed="rId3"', `r:embed="${first}"`)
    .replace('r:embed="rId3"', `r:embed="${second}"`);
  zip.file("ppt/slides/slide1.xml", slideXml);
  const cleanup = await removeUnreferencedSlideImageRelationships(zip);
  assert.equal(cleanup.count, 2);
  const relsXml = await zip.file("ppt/slides/_rels/slide1.xml.rels")?.async("string");
  assert.doesNotMatch(relsXml ?? "", /Id="rId3"|Id="rId4"/);
  assert.match(relsXml ?? "", /Id="rId5"/);
  assert.match(relsXml ?? "", /Id="rId6"/);
});
