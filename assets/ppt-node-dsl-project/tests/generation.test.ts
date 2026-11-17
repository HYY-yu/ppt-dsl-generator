import assert from "node:assert/strict";
import test from "node:test";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compileTemplate } from "../src/compile.js";
import { validateDeckInput } from "../src/validation.js";
import { analyzeTemplate } from "../src/pptx/analyze.js";
import { attachTemplateFingerprint } from "../src/template-contract.js";
import { generateDeck } from "../src/pptx/generate.js";
import { readPptx } from "../src/pptx/read.js";
import { parseSlideNodes, flattenNodes, maxShapeId } from "../src/pptx/nodes.js";
import { verifyDeckPackage } from "../src/pptx/verify.js";
import { validateDeckContent } from "../src/validation.js";
import type { DeckInput } from "../src/types.js";

// Both distributions keep a learning template; never use it as a production default.
async function learningTemplate(): Promise<string> {
  const publicPath = fileURLToPath(new URL("../../../examples/ppt_example.pptx", import.meta.url));
  try { await access(publicPath); return publicPath; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return fileURLToPath(new URL("../fixtures/seed-template/ppt_example.pptx", import.meta.url));
  }
}

test("generates reordered template pages with shared background, native SVG, rich text and implicit numbers", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "ppt-dsl-generation-"));
  try {
    const zip = await readPptx(await learningTemplate());
    // Swap two physical parts and their relationship targets, preserving display order.
    const partA = "ppt/slides/slide1.xml", partB = "ppt/slides/slide2.xml";
    const xmlA = await zip.file(partA)!.async("string"), xmlB = await zip.file(partB)!.async("string");
    zip.file(partA, xmlB); zip.file(partB, xmlA);
    const relA = "ppt/slides/_rels/slide1.xml.rels", relB = "ppt/slides/_rels/slide2.xml.rels";
    const relXmlA = await zip.file(relA)!.async("string"), relXmlB = await zip.file(relB)!.async("string");
    zip.file(relA, relXmlB); zip.file(relB, relXmlA);
    const presentationRels = await zip.file("ppt/_rels/presentation.xml.rels")!.async("string");
    zip.file("ppt/_rels/presentation.xml.rels", presentationRels.replace(/slides\/slide([12])\.xml/g, (_, n) => `slides/slide${n === "1" ? "2" : "1"}.xml`));
    // A one-pixel raster is enough to verify packaging and media sharing.
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF1sAAAAASUVORK5CYII=", "base64");
    const backgroundPath = path.join(dir, "background.png");
    await writeFile(backgroundPath, png);
    zip.file("ppt/media/test-background.png", png);
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path fill="currentColor" d="M2 2h20v20H2z"/></svg>';
    const iconPath = path.join(dir, "icon.svg");
    await writeFile(iconPath, svg);
    zip.file("ppt/media/test-icon.svg", svg);
    zip.file("[Content_Types].xml", (await zip.file("[Content_Types].xml")!.async("string")).replace("</Types>", '<Override PartName="/ppt/media/test-background.png" ContentType="image/png"/><Override PartName="/ppt/media/test-icon.svg" ContentType="image/svg+xml"/></Types>'));
    const source = await analyzeTemplate(zip, "fixture.pptx");
    for (const slide of source.slides) {
      let xml = await zip.file(slide.slidePath)!.async("string");
      const shapeId = maxShapeId(xml) + 1;
      const picture = `<p:pic><p:nvPicPr><p:cNvPr id="${shapeId}" name="@背景"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId9999"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1000000" cy="1000000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
      // A native source SVG without PNG fallback exercises the Automizer cleanup regression.
      const icon = picture.replace(`id="${shapeId}" name="@背景"`, `id="${shapeId + 1}" name="@图标"`).replace('<a:blip r:embed="rId9999"/>', '<a:blip><a:extLst><a:ext uri="{96DAC541-7B7A-43D3-8B79-37D633B846F1}"><asvg:svgBlip xmlns:asvg="http://schemas.microsoft.com/office/drawing/2016/SVG/main" r:embed="rId9998"/></a:ext></a:extLst></a:blip>');
      xml = xml.replace("</p:spTree>", picture + icon + "</p:spTree>");
      zip.file(slide.slidePath, xml);
      const relPath = slide.slidePath.replace("/slides/", "/slides/_rels/") + ".rels";
      const rels = await zip.file(relPath)!.async("string");
      zip.file(relPath, rels.replace("</Relationships>", '<Relationship Id="rId9999" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/test-background.png"/><Relationship Id="rId9998" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/test-icon.svg"/></Relationships>'));
    }
    const templatePath = path.join(dir, "template.pptx");
    await writeFile(templatePath, await zip.generateAsync({ type: "nodebuffer" }));
    const manifest = await attachTemplateFingerprint(await analyzeTemplate(zip, templatePath), templatePath);
    const input = JSON.parse(await readFile(new URL("../fixtures/generation-input.json", import.meta.url), "utf8")) as DeckInput;
    // The project learning fixture has additional pages; resolve the ending by type.
    input.slides.at(-1)!.templateId = manifest.slides.find(s => s.pageType === "结尾页")!.templateId;
    let richShapeId = "";
    for (const slide of input.slides) {
      const contract = manifest.slides.find(s => s.templateId === slide.templateId)!;
      slide.nodes ??= {};
      for (const node of contract.nodes) {
        if (node.kind === "background") slide.nodes[node.key] = backgroundPath;
        if (node.kind === "icon") slide.nodes[node.key] = iconPath;
        if (node.kind === "number") delete slide.nodes[node.key];
      }
      if (contract.pageType === "内容页") {
        const longText = contract.nodes.find(n => n.kind === "text" && (n.length?.max ?? 0) >= 40);
        if (longText) {
          const text = "原生富文本保留模板字体与固定几何，并与共享背景和确定性序号共同生成可验证的演示文稿。";
          slide.nodes[longText.key] = { paragraphs: [{ list: "bullet", runs: [{ text, bold: true, underline: false }] }] };
          richShapeId = longText.locator.shapeId;
        }
      }
    }
    // Ensure the test exercises rich text even when this deck selected only list content.
    if (!richShapeId) {
      const contentIndex = input.slides.findIndex(s => manifest.slides.find(t => t.templateId === s.templateId)?.pageType === "内容页");
      const contract = manifest.slides.find(s => s.nodes.some(n => n.kind === "text" && (n.length?.max ?? 0) >= 40) && s.pageType === "内容页" && s.lists.length === 0)!;
      assert.ok(contract, "learning template must contain a long-text content page");
      const nodes: NonNullable<DeckInput["slides"][number]["nodes"]> = {};
      for (const n of contract.nodes) {
        if (n.kind === "background") nodes[n.key] = backgroundPath;
        else if (n.kind === "icon") nodes[n.key] = iconPath;
        else if (n.kind === "text") {
          const text = "验证内容".repeat(Math.ceil((n.length?.min ?? 1) / 4)).slice(0, n.length?.max);
          nodes[n.key] = (n.length?.max ?? 0) >= 40 ? { paragraphs: [{ list: "bullet", runs: [{ text, bold: true, underline: false }] }] } : text;
          if ((n.length?.max ?? 0) >= 40) richShapeId = n.locator.shapeId;
        } else throw new Error(`Unexpected fixture component ${n.kind}`);
      }
      input.slides[contentIndex] = { templateId: contract.templateId, nodes };
    }
    // Background paths belong only to final input, never to the model's content draft.
    const draft = structuredClone(input);
    for (const slide of draft.slides) {
      const contract = manifest.slides.find(s => s.templateId === slide.templateId)!;
      for (const n of contract.nodes) if (n.kind === "background" || n.kind === "icon") delete slide.nodes?.[n.key];
    }
    assert.deepEqual(await validateDeckContent(manifest, draft), []);
    const compiled = await compileTemplate(templatePath, path.join(dir, "compiled"));
    assert.equal(compiled.templateSha256, manifest.templateSha256);
    const invalid = structuredClone(input);
    invalid.slides[0].templateId = "missing-template";
    assert.ok((await validateDeckInput(manifest, invalid)).length);
    const outPath = path.join(dir, "deck.pptx");
    await generateDeck({ templatePath, manifest, input, outPath });
    const output = await readPptx(outPath);
    const secondPath = path.join(dir, "deck-second.pptx");
    await generateDeck({ templatePath, manifest, input, outPath: secondPath });
    const second = await readPptx(secondPath);
    const parts = Object.keys(output.files).filter(n => /^ppt\/slides\/.*\.xml$/.test(n)).sort();
    assert.deepEqual(parts, Object.keys(second.files).filter(n => /^ppt\/slides\/.*\.xml$/.test(n)).sort());
    // Automizer assigns fresh creation IDs. Compare user-visible content and fixed geometry.
    const structure = (xml: string) => flattenNodes(parseSlideNodes(xml)).map(n => ({ id: n.id, name: n.name, box: n.box, text: [...n.raw.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map(m => m[1]) }));
    for (const part of parts) {
      if (!/\/slide\d+\.xml$/.test(part)) continue;
      assert.deepEqual(structure(await output.file(part)!.async("string")), structure(await second.file(part)!.async("string")), part);
    }
    assert.equal((await verifyDeckPackage(second)).passed, true);

    const report = await verifyDeckPackage(output);
    assert.equal(report.passed, true, report.errors.join("; "));
    assert.equal(report.slides, input.slides.length);
    assert.equal(report.nativeSvgEmbeddings, input.slides.length);
    let hasRichText = false;
    const backgroundTargets = new Set<string>();
    for (const name of Object.keys(output.files).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n))) {
      const xml = await output.file(name)!.async("string");
      const rich = flattenNodes(parseSlideNodes(xml)).find(n => n.id === richShapeId && n.raw.includes("<a:buChar"));
      if (rich) { assert.match(rich.raw, /b="1"/); hasRichText = true; }
      const rels = await output.file(name.replace("/slides/", "/slides/_rels/") + ".rels")!.async("string");
      for (const m of rels.matchAll(/Target="([^\"]*node-dsl-[^\"]*\.png)"/g)) backgroundTargets.add(m[1]);
    }
    assert.equal(hasRichText, true);
    assert.equal(backgroundTargets.size, 1, "all pages must share one embedded raster");
  } finally { await rm(dir, { recursive: true, force: true }); }
});
