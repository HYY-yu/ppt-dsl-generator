import assert from "node:assert/strict";
import test from "node:test";
import { centerCropRasterPictureXml, rasterDimensions } from "../src/pptx/generate.js";

const wideBox = { x: 0, y: 0, cx: 200, cy: 100 };
const tallBox = { x: 0, y: 0, cx: 100, cy: 200 };
const picture = `<p:pic><p:blipFill><a:blip r:embed="rId1"/><a:srcRect l="1200"/><a:tile algn="tl"/></p:blipFill></p:pic>`;

test("center-crops a square raster into a wide image frame", () => {
  const xml = centerCropRasterPictureXml(picture, 1024, 1024, wideBox);
  assert.match(xml, /<a:srcRect l="0" t="25000" r="0" b="25000"\/>/);
  assert.match(xml, /<a:stretch><a:fillRect\/><\/a:stretch>/);
  assert.doesNotMatch(xml, /<a:tile\b/);
  assert.doesNotMatch(xml, /l="1200"/);
});

test("center-crops a square raster into a tall image frame", () => {
  const xml = centerCropRasterPictureXml(picture, 1024, 1024, tallBox);
  assert.match(xml, /<a:srcRect l="25000" t="0" r="25000" b="0"\/>/);
});

test("keeps same-aspect rasters uncropped while using stretch fill", () => {
  const xml = centerCropRasterPictureXml(picture, 1600, 800, wideBox);
  assert.doesNotMatch(xml, /<a:srcRect\b/);
  assert.match(xml, /<a:stretch><a:fillRect\/><\/a:stretch>/);
});

test("center-crops raster fills stored in shape a:blipFill nodes", () => {
  const shape = `<p:sp><p:spPr><a:blipFill><a:blip r:embed="rId1"/><a:srcRect l="1200"/><a:tile/></a:blipFill></p:spPr></p:sp>`;
  const xml = centerCropRasterPictureXml(shape, 1024, 1024, wideBox);
  assert.match(xml, /<a:blip r:embed="rId1"\/><a:srcRect l="0" t="25000" r="0" b="25000"\/><a:stretch><a:fillRect\/><\/a:stretch>/);
  assert.doesNotMatch(xml, /<a:tile\b|l="1200"/);
});

test("reads PNG, GIF, and JPEG dimensions without an image dependency", () => {
  const png = Buffer.alloc(24);
  png.write("\x89PNG", 0, "binary");
  png.writeUInt32BE(1024, 16);
  png.writeUInt32BE(1024, 20);
  assert.deepEqual(rasterDimensions(png, ".png"), { width: 1024, height: 1024 });

  const gif = Buffer.alloc(10);
  gif.write("GIF89a", 0, "ascii");
  gif.writeUInt16LE(640, 6);
  gif.writeUInt16LE(480, 8);
  assert.deepEqual(rasterDimensions(gif, ".gif"), { width: 640, height: 480 });

  const jpeg = Buffer.alloc(21);
  jpeg.set([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0xe0, 0x02, 0x80]);
  assert.deepEqual(rasterDimensions(jpeg, ".jpg"), { width: 640, height: 480 });
});
