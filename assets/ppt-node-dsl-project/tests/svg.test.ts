import assert from "node:assert/strict";
import test from "node:test";
import { canonicalListIconSides, embedNativeSvgInPictureXml, normalizeSvgForOffice, removeNativeSvgFromPictureXml, resolveIconColor, squareBoxAtCenter } from "../src/pptx/generate.js";
import type { ListManifest } from "../src/types.js";

function iconOnBackground(fill: string): string {
  return `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="Background"/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1000" cy="1000"/></a:xfrm><a:solidFill>${fill}</a:solidFill></p:spPr></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="@图标"/></p:nvSpPr><p:spPr><a:xfrm><a:off x="250" y="250"/><a:ext cx="500" cy="500"/></a:xfrm></p:spPr></p:sp></p:spTree></p:cSld></p:sld>`;
}

test("embeds native Office SVG without a fallback relationship", () => {
  const raw = `<p:pic><p:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></p:blipFill></p:pic>`;
  const updated = embedNativeSvgInPictureXml(raw, "rId3");
  assert.match(updated, /<a:blip>/);
  assert.doesNotMatch(updated, /<a:blip\b[^>]*r:embed=/);
  assert.match(updated, /<a:ext uri="\{96DAC541-7B7A-43D3-8B79-37D633B846F1\}">/);
  assert.match(updated, /<asvg:svgBlip xmlns:asvg="http:\/\/schemas\.microsoft\.com\/office\/drawing\/2016\/SVG\/main" r:embed="rId3"\/>/);
});

test("preserves other blip extensions when adding native SVG", () => {
  const raw = `<p:pic><p:blipFill><a:blip r:embed="rId1"><a:extLst><a:ext uri="dpi"><a14:useLocalDpi val="0"/></a:ext></a:extLst></a:blip></p:blipFill></p:pic>`;
  const updated = embedNativeSvgInPictureXml(raw, "rId3");
  assert.match(updated, /a14:useLocalDpi/);
  assert.match(updated, /asvg:svgBlip[^>]*r:embed="rId3"/);
  assert.doesNotMatch(updated, /<a:blip\b[^>]*r:embed=/);
});

test("updates an existing SVG relationship without duplicating the extension", () => {
  const first = embedNativeSvgInPictureXml(`<a:blip r:embed="rId1"/>`, "rId3");
  const updated = embedNativeSvgInPictureXml(first, "rId5");
  assert.equal((updated.match(/<asvg:svgBlip\b/g) ?? []).length, 1);
  assert.doesNotMatch(updated, /<a:blip\b[^>]*r:embed=/);
  assert.match(updated, /asvg:svgBlip[^>]*r:embed="rId5"/);
});

test("removes the native SVG extension when replacing it with a raster image", () => {
  const source = `<a:blip r:embed="rId1"><a:extLst><a:ext uri="dpi"><a14:useLocalDpi val="0"/></a:ext></a:extLst></a:blip>`;
  const native = embedNativeSvgInPictureXml(source, "rId3");
  const updated = removeNativeSvgFromPictureXml(native, "rId4");
  assert.doesNotMatch(updated, /asvg:svgBlip/);
  assert.doesNotMatch(updated, /<a:extLst>\s*<\/a:extLst>/);
  assert.match(updated, /r:embed="rId4"/);
  assert.match(updated, /a14:useLocalDpi/);
});

test("materializes currentColor as white for PowerPoint by default", () => {
  const normalized = normalizeSvgForOffice(Buffer.from(`<svg fill="currentColor" stroke="CURRENTCOLOR"/>`));
  assert.equal(normalized.toString("utf8"), `<svg fill="#FFFFFF" stroke="#FFFFFF"/>`);
});

test("uses white icons on a non-white template background", () => {
  assert.deepEqual(resolveIconColor(iconOnBackground(`<a:schemeClr val="accent1"/>`), "3"), {
    color: "#FFFFFF",
    background: "non-white",
    shapeId: "2",
  });
});

test("uses dark gray icons only on a white or near-white template background", () => {
  const decision = resolveIconColor(iconOnBackground(`<a:srgbClr val="FAFAFA"/>`), "3");
  assert.deepEqual(decision, { color: "#404040", background: "white", shapeId: "2" });
  const normalized = normalizeSvgForOffice(Buffer.from(`<svg stroke="currentColor"/>`), decision.color);
  assert.equal(normalized.toString("utf8"), `<svg stroke="#404040"/>`);
});

test("inherits each list icon slot size from the first item shorter edge", () => {
  const list = {
    items: [
      {
        itemIndex: 1,
        components: [
          { key: "icon_1", kind: "icon", locator: { box: { x: 0, y: 0, cx: 398462, cy: 377825 } } },
          { key: "icon_2", kind: "icon", locator: { box: { x: 0, y: 0, cx: 258016, cy: 289659 } } },
        ],
      },
      {
        itemIndex: 2,
        components: [
          { key: "icon_1", kind: "icon", locator: { box: { x: 0, y: 0, cx: 377825, cy: 441325 } } },
          { key: "icon_2", kind: "icon", locator: { box: { x: 0, y: 0, cx: 400000, cy: 400000 } } },
        ],
      },
    ],
  } as unknown as ListManifest;
  assert.deepEqual([...canonicalListIconSides(list)], [
    ["icon_1", 377825],
    ["icon_2", 258016],
  ]);
});

test("makes icon slots square without changing their center", () => {
  const source = { x: 100, y: 200, cx: 120, cy: 80 };
  const normalized = squareBoxAtCenter(source, 80);
  assert.deepEqual(normalized, { x: 120, y: 200, cx: 80, cy: 80 });
  assert.equal(source.x + source.cx / 2, normalized.x + normalized.cx / 2);
  assert.equal(source.y + source.cy / 2, normalized.y + normalized.cy / 2);
});
