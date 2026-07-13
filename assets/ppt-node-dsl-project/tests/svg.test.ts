import assert from "node:assert/strict";
import test from "node:test";
import { embedNativeSvgInPictureXml, removeNativeSvgFromPictureXml } from "../src/pptx/generate.js";

test("embeds native Office 2019 SVG with a transparent fallback relationship", () => {
  const raw = `<p:pic><p:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></p:blipFill></p:pic>`;
  const updated = embedNativeSvgInPictureXml(raw, "rId2", "rId3");
  assert.match(updated, /<a:blip r:embed="rId2">/);
  assert.match(updated, /<a:ext uri="\{96DAC541-7B7A-43D3-8B79-37D633B846F1\}">/);
  assert.match(updated, /<asvg:svgBlip xmlns:asvg="http:\/\/schemas\.microsoft\.com\/office\/drawing\/2016\/SVG\/main" r:embed="rId3"\/>/);
});

test("preserves other blip extensions when adding native SVG", () => {
  const raw = `<p:pic><p:blipFill><a:blip r:embed="rId1"><a:extLst><a:ext uri="dpi"><a14:useLocalDpi val="0"/></a:ext></a:extLst></a:blip></p:blipFill></p:pic>`;
  const updated = embedNativeSvgInPictureXml(raw, "rId2", "rId3");
  assert.match(updated, /a14:useLocalDpi/);
  assert.match(updated, /asvg:svgBlip[^>]*r:embed="rId3"/);
});

test("updates an existing SVG relationship without duplicating the extension", () => {
  const first = embedNativeSvgInPictureXml(`<a:blip r:embed="rId1"/>`, "rId2", "rId3");
  const updated = embedNativeSvgInPictureXml(first, "rId4", "rId5");
  assert.equal((updated.match(/<asvg:svgBlip\b/g) ?? []).length, 1);
  assert.match(updated, /<a:blip r:embed="rId4">/);
  assert.match(updated, /asvg:svgBlip[^>]*r:embed="rId5"/);
});

test("removes the native SVG extension when replacing it with a raster image", () => {
  const source = `<a:blip r:embed="rId1"><a:extLst><a:ext uri="dpi"><a14:useLocalDpi val="0"/></a:ext></a:extLst></a:blip>`;
  const native = embedNativeSvgInPictureXml(source, "rId2", "rId3");
  const updated = removeNativeSvgFromPictureXml(native);
  assert.doesNotMatch(updated, /asvg:svgBlip/);
  assert.doesNotMatch(updated, /<a:extLst>\s*<\/a:extLst>/);
  assert.match(updated, /r:embed="rId2"/);
  assert.match(updated, /a14:useLocalDpi/);
});
