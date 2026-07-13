import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import path from "node:path";
import { Automizer } from "pptx-automizer";
import type { ISlide } from "pptx-automizer";
import { parseGroupName } from "../dsl/parse.js";
import type { Box, ComponentManifest, DeckInput, ListItemManifest, ListManifest, NodeValue, SlideManifest, TemplateManifest } from "../types.js";
import { assertValidDeckInput } from "../validation.js";
import { assertManifestMatchesTemplate } from "../template-contract.js";
import { flattenNodes, maxShapeId, parseSlideNodes, reassignShapeIds, renameFirstNode, replaceNodeRaw, replaceTextInNode, setGroupBox, type XmlNode } from "./nodes.js";
import { readPptx } from "./read.js";
import { ownerPartForRelationshipPart, parsePresentationSlideRelIds, parseRelationships, relationshipPartForOwner, resolveRelationshipTarget } from "./relationships.js";

const TEMPLATE_LABEL = "node_dsl_template";
const execFileAsync = promisify(execFile);

export async function generateDeck(options: { templatePath: string; manifest: TemplateManifest; input: DeckInput; outPath: string }): Promise<void> {
  await assertManifestMatchesTemplate(options.manifest, options.templatePath);
  await assertValidDeckInput(options.manifest, options.input);
  await mkdir(path.dirname(options.outPath), { recursive: true });
  const templateBuffer = await readFile(options.templatePath);
  const automizer = new Automizer({
    outputDir: `${path.dirname(options.outPath)}${path.sep}`,
    removeExistingSlides: true,
    autoImportSlideMasters: true,
    assertRelatedContents: true,
    cleanup: true,
    compression: 6,
    verbosity: 1,
  });
  let presentation = automizer.loadRoot(templateBuffer).load(templateBuffer, TEMPLATE_LABEL);
  for (const inputSlide of options.input.slides) {
    const template = getSlide(options.manifest, inputSlide.templateId);
    presentation = presentation.addSlide(TEMPLATE_LABEL, template.slideNumber, (slide: ISlide) => { void slide; });
  }
  const summary = await presentation.write(path.basename(options.outPath));
  await patchGeneratedDeck(options.outPath, options.manifest, options.input);
  console.info(`[generate] status=${summary.status} outputSlides=${options.input.slides.length} automizerParts=${summary.slides}`);
}

async function patchGeneratedDeck(outPath: string, manifest: TemplateManifest, input: DeckInput): Promise<void> {
  const zip = await readPptx(outPath);
  const slidePaths = await outputSlidePaths(zip);
  if (slidePaths.length !== input.slides.length) {
    throw new Error(`输出页数 ${slidePaths.length} 与 DeckInput 页数 ${input.slides.length} 不一致`);
  }
  let mediaCounter = 0;
  for (let slideIndex = 0; slideIndex < input.slides.length; slideIndex += 1) {
    const inputSlide = input.slides[slideIndex];
    const templateSlide = getSlide(manifest, inputSlide.templateId);
    const slidePath = slidePaths[slideIndex];
    const file = zip.file(slidePath);
    if (!file) throw new Error(`输出缺少 slide: ${slidePath}`);
    let xml = await file.async("string");
    for (const component of templateSlide.nodes) {
      const value = inputSlide.nodes?.[component.key];
      if (value === undefined) continue;
      xml = await patchComponent(zip, slidePath, xml, component.locator.shapeId, component, value, () => ++mediaCounter);
    }
    for (const list of templateSlide.lists) {
      const items = inputSlide.lists?.[list.key] ?? [];
      xml = list.dynamic
        ? await patchDynamicList(zip, slidePath, xml, list, items, () => ++mediaCounter)
        : await patchFixedList(zip, slidePath, xml, list, items, () => ++mediaCounter);
    }
    xml = cleanDslNames(xml);
    zip.file(slidePath, xml);
  }
  const removedNotesParts = await removeSpeakerNotes(zip);
  const removedOrphanRelationshipParts = removeOrphanRelationshipParts(zip);
  const dangling = await removeDanglingRelationships(zip);
  console.info(`[generate:cleanup] notesParts=${removedNotesParts} orphanRelationshipParts=${removedOrphanRelationshipParts}`);
  if (dangling.count > 0) {
    console.warn(`[generate:cleanup] danglingRelationshipsRemoved=${dangling.count} samples=${dangling.samples.join(",")}`);
  }
  await writeFile(outPath, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } }));
}

async function patchFixedList(
  zip: Awaited<ReturnType<typeof readPptx>>,
  slidePath: string,
  xml: string,
  list: ListManifest,
  items: Array<Record<string, NodeValue>>,
  nextMedia: () => number,
): Promise<string> {
  let output = xml;
  for (let index = 0; index < items.length; index += 1) {
    for (const component of list.items[index]?.components ?? []) {
      const value = items[index][component.key] ?? (component.kind === "number" ? index + 1 : undefined);
      if (value !== undefined) output = await patchComponent(zip, slidePath, output, component.locator.shapeId, component, value, nextMedia);
    }
  }
  return output;
}

async function patchDynamicList(
  zip: Awaited<ReturnType<typeof readPptx>>,
  slidePath: string,
  xml: string,
  list: ListManifest,
  items: Array<Record<string, NodeValue>>,
  nextMedia: () => number,
): Promise<string> {
  const roots = parseSlideNodes(xml);
  const groups = flattenNodes(roots)
    .filter((node) => node.type === "grpSp" && parseGroupName(node.name)?.listIndex === list.listIndex)
    .sort((a, b) => parseGroupName(a.name)!.itemIndex - parseGroupName(b.name)!.itemIndex);
  if (!groups.length) throw new Error(`${slidePath} 找不到变长列表 Group: ${list.key}`);
  const region = unionBoxes(groups.map((group) => group.box).filter((box): box is Box => Boolean(box)));
  const slots = layoutSlots(region, groups[0].box ?? region, items.length, list.layout);
  let nextShapeIdValue = maxShapeId(xml) + 1;
  const nextShapeId = () => nextShapeIdValue++;
  const prepared: string[] = [];
  for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
    const source = groups[itemIndex] ?? groups[0];
    const sourceGroupIndex = parseGroupName(source.name)?.itemIndex ?? 1;
    const sourceManifestItem = list.items.find((item) => item.itemIndex === sourceGroupIndex) ?? list.items[0];
    let raw = source.raw;
    raw = await patchComponentsInsideGroup(zip, slidePath, raw, sourceManifestItem, items[itemIndex], itemIndex, nextMedia);
    if (!groups[itemIndex]) raw = reassignShapeIds(raw, nextShapeId);
    raw = renameFirstNode(raw, `@${list.listIndex}@${itemIndex + 1}`);
    raw = setGroupBox(raw, slots[itemIndex]);
    prepared.push(raw);
  }
  const ranges = groups.map((group) => ({ start: group.start, end: group.end })).sort((a, b) => b.start - a.start);
  let output = xml;
  for (const range of ranges) output = `${output.slice(0, range.start)}${output.slice(range.end)}`;
  const insertion = prepared.join("");
  return output.replace("</p:spTree>", `${insertion}</p:spTree>`);
}

async function patchComponentsInsideGroup(
  zip: Awaited<ReturnType<typeof readPptx>>,
  slidePath: string,
  raw: string,
  manifestItem: ListItemManifest,
  values: Record<string, NodeValue>,
  itemIndex: number,
  nextMedia: () => number,
): Promise<string> {
  let output = raw;
  for (const contract of [...manifestItem.components].reverse()) {
    const value = values[contract.key] ?? (contract.kind === "number" ? itemIndex + 1 : undefined);
    if (value === undefined) continue;
    const freshNode = flattenNodes(parseSlideNodes(output)).find((node) => node.id === contract.locator.shapeId);
    if (!freshNode) throw new Error(`${slidePath} Group 内找不到 shapeId=${contract.locator.shapeId} (${contract.key})`);
    output = await patchComponentNode(zip, slidePath, output, freshNode, contract, value, nextMedia);
  }
  return output;
}

async function patchComponent(
  zip: Awaited<ReturnType<typeof readPptx>>,
  slidePath: string,
  xml: string,
  shapeId: string,
  component: ComponentManifest,
  value: NodeValue,
  nextMedia: () => number,
): Promise<string> {
  const node = flattenNodes(parseSlideNodes(xml)).find((candidate) => candidate.id === shapeId);
  if (!node) throw new Error(`${slidePath} 找不到 shapeId=${shapeId} (${component.key})`);
  return patchComponentNode(zip, slidePath, xml, node, component, value, nextMedia);
}

async function patchComponentNode(
  zip: Awaited<ReturnType<typeof readPptx>>,
  slidePath: string,
  xml: string,
  node: XmlNode,
  component: ComponentManifest,
  value: NodeValue,
  nextMedia: () => number,
): Promise<string> {
  if (component.kind === "text" || component.kind === "number") {
    const text = component.kind === "number" ? formatNumber(value, component.numberWidth) : String(value);
    return replaceNodeRaw(xml, node, replaceTextInNode(node.raw, text));
  }
  const sourcePath = typeof value === "object" ? value.path : String(value);
  const relId = node.relId ?? await addImageRelationship(zip, slidePath, sourcePath, nextMedia());
  if (node.relId) await retargetImageRelationship(zip, slidePath, relId, sourcePath, nextMedia());
  const replacement = node.relId ? node.raw : pictureXml(node, relId);
  return replaceNodeRaw(xml, node, replacement);
}

function formatNumber(value: NodeValue, width = 1): string {
  const raw = typeof value === "object" ? value.path : String(value);
  const numeric = Number(raw);
  return Number.isFinite(numeric) ? String(numeric).padStart(width, "0") : raw;
}

async function addImageRelationship(zip: Awaited<ReturnType<typeof readPptx>>, slidePath: string, sourcePath: string, serial: number): Promise<string> {
  const relPath = relationshipPartForOwner(slidePath);
  const relFile = zip.file(relPath);
  if (!relFile) throw new Error(`${slidePath} 缺少 relationships`);
  let relXml = await relFile.async("string");
  const ids = [...relXml.matchAll(/\bId="rId(\d+)"/g)].map((match) => Number(match[1]));
  const relId = `rId${Math.max(0, ...ids) + 1}`;
  const mediaName = await addMedia(zip, sourcePath, serial);
  relXml = relXml.replace("</Relationships>", `<Relationship Id="${relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${mediaName}"/></Relationships>`);
  zip.file(relPath, relXml);
  return relId;
}

async function retargetImageRelationship(zip: Awaited<ReturnType<typeof readPptx>>, slidePath: string, relId: string, sourcePath: string, serial: number): Promise<void> {
  const relPath = relationshipPartForOwner(slidePath);
  const file = zip.file(relPath);
  if (!file) throw new Error(`${slidePath} 缺少 relationships`);
  const mediaName = await addMedia(zip, sourcePath, serial);
  const xml = await file.async("string");
  const updated = xml.replace(/<Relationship\b[^>]*\/>/g, (relationship) => {
    if (!new RegExp(`\\bId="${escapeRegExp(relId)}"`).test(relationship)) return relationship;
    return relationship.replace(/\bTarget="[^"]*"/, `Target="../media/${mediaName}"`);
  });
  if (updated === xml) throw new Error(`${slidePath} 找不到图片关系 ${relId}`);
  zip.file(relPath, updated);
}

async function addMedia(zip: Awaited<ReturnType<typeof readPptx>>, sourcePath: string, serial: number): Promise<string> {
  const asset = await readPowerPointAsset(sourcePath);
  const extension = asset.extension;
  const name = `node-dsl-${serial}${extension}`;
  zip.file(`ppt/media/${name}`, asset.buffer);
  await ensureContentType(zip, extension);
  return name;
}

async function readPowerPointAsset(sourcePath: string): Promise<{ buffer: Buffer; extension: string }> {
  const extension = path.extname(sourcePath).toLowerCase();
  if (extension !== ".svg") return { buffer: await readFile(sourcePath), extension };
  const directory = await mkdtemp(path.join(tmpdir(), "ppt-node-dsl-svg-"));
  try {
    if (process.platform !== "darwin") {
      throw new Error("SVG 图标需要先转换为透明 PNG；当前运行环境未提供 macOS sips 转换器");
    }
    const outputPath = path.join(directory, `${path.basename(sourcePath, ".svg")}.png`);
    await execFileAsync("/usr/bin/sips", ["-s", "format", "png", sourcePath, "--out", outputPath]);
    console.info(`[generate] SVG rasterized for PowerPoint compatibility: ${path.basename(sourcePath)}`);
    return { buffer: await readFile(outputPath), extension: ".png" };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function ensureContentType(zip: Awaited<ReturnType<typeof readPptx>>, extension: string): Promise<void> {
  const mime = ({ ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif" } as Record<string, string>)[extension];
  if (!mime) throw new Error(`不支持图片格式: ${extension}`);
  const file = zip.file("[Content_Types].xml");
  if (!file) return;
  const xml = await file.async("string");
  const ext = extension.slice(1);
  if (new RegExp(`<Default\\b[^>]*Extension="${escapeRegExp(ext)}"`, "i").test(xml)) return;
  zip.file("[Content_Types].xml", xml.replace("</Types>", `<Default Extension="${ext}" ContentType="${mime}"/></Types>`));
}

function pictureXml(node: XmlNode, relId: string): string {
  const box = node.box ?? { x: 0, y: 0, cx: 1, cy: 1 };
  return `<p:pic><p:nvPicPr><p:cNvPr id="${node.id}" name="${escapeXml(node.name)}"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="${box.x}" y="${box.y}"/><a:ext cx="${box.cx}" cy="${box.cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr></p:pic>`;
}

function layoutSlots(region: Box, source: Box, count: number, layout: "row" | "column"): Box[] {
  if (!count) return [];
  if (layout === "row") {
    const slotWidth = region.cx / count;
    const scale = Math.min(1, slotWidth / source.cx);
    const cx = source.cx * scale;
    const cy = source.cy * scale;
    return Array.from({ length: count }, (_, index) => ({ x: region.x + index * slotWidth + (slotWidth - cx) / 2, y: region.y + (region.cy - cy) / 2, cx, cy }));
  }
  const slotHeight = region.cy / count;
  const scale = Math.min(1, slotHeight / source.cy);
  const cx = source.cx * scale;
  const cy = source.cy * scale;
  return Array.from({ length: count }, (_, index) => ({ x: region.x + (region.cx - cx) / 2, y: region.y + index * slotHeight + (slotHeight - cy) / 2, cx, cy }));
}

function unionBoxes(boxes: Box[]): Box {
  if (!boxes.length) return { x: 0, y: 0, cx: 1, cy: 1 };
  const x = Math.min(...boxes.map((box) => box.x));
  const y = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.cx));
  const bottom = Math.max(...boxes.map((box) => box.y + box.cy));
  return { x, y, cx: right - x, cy: bottom - y };
}

function cleanDslNames(xml: string): string {
  return xml.replace(/(<p:cNvPr\b[^>]*\bid="([^"]+)"[^>]*\bname=")\s*[@＠][^"]*(")/g, `$1Generated shape $2$3`);
}

async function outputSlidePaths(zip: Awaited<ReturnType<typeof readPptx>>): Promise<string[]> {
  const presentationXml = await zip.file("ppt/presentation.xml")?.async("string");
  const relsXml = await zip.file("ppt/_rels/presentation.xml.rels")?.async("string");
  if (!presentationXml || !relsXml) throw new Error("输出 PPTX 缺少 presentation parts");
  const targets = new Map(parseRelationships(relsXml).filter((rel) => rel.type.endsWith("/slide")).map((rel) => [rel.id, resolveRelationshipTarget("ppt/presentation.xml", rel.target)]));
  return parsePresentationSlideRelIds(presentationXml).map((relId) => targets.get(relId)).filter((value): value is string => Boolean(value));
}

async function removeSpeakerNotes(zip: Awaited<ReturnType<typeof readPptx>>): Promise<number> {
  let removed = 0;
  for (const filePath of Object.keys(zip.files).filter((name) => name.endsWith(".rels"))) {
    const file = zip.file(filePath); if (!file) continue;
    const xml = await file.async("string");
    zip.file(filePath, xml.replace(/<Relationship\b[^>]*Type="[^"]+\/(?:notesSlide|notesMaster)"[^>]*\/>/g, () => { removed += 1; return ""; }));
  }
  for (const filePath of Object.keys(zip.files)) if (filePath.startsWith("ppt/notesSlides/") || filePath.startsWith("ppt/notesMasters/")) { zip.remove(filePath); removed += 1; }
  const contentTypes = zip.file("[Content_Types].xml");
  if (contentTypes) zip.file("[Content_Types].xml", (await contentTypes.async("string")).replace(/<Override\b[^>]*PartName="\/ppt\/notes(?:Slides|Masters)\/[^"]+"[^>]*\/>/g, ""));
  const presentation = zip.file("ppt/presentation.xml");
  if (presentation) zip.file("ppt/presentation.xml", (await presentation.async("string")).replace(/<p:notesMasterIdLst>[\s\S]*?<\/p:notesMasterIdLst>/g, ""));
  return removed;
}

async function removeDanglingRelationships(zip: Awaited<ReturnType<typeof readPptx>>): Promise<{ count: number; samples: string[] }> {
  let removed = 0;
  const samples: string[] = [];
  for (const filePath of Object.keys(zip.files).filter((name) => name.endsWith(".rels"))) {
    const file = zip.file(filePath); if (!file) continue;
    const ownerDir = path.posix.dirname(path.posix.dirname(filePath));
    const xml = await file.async("string");
    const updated = xml.replace(/<Relationship\b[^>]*\/>/g, (relationship) => {
      if (/TargetMode="External"/.test(relationship)) return relationship;
      const target = relationship.match(/\bTarget="([^"]+)"/)?.[1];
      if (!target || target.startsWith("#")) return relationship;
      if (zip.file(path.posix.normalize(path.posix.join(ownerDir, target)))) return relationship;
      removed += 1;
      if (samples.length < 5) samples.push(`${filePath}->${target}`);
      return "";
    });
    zip.file(filePath, updated);
  }
  return { count: removed, samples };
}

function removeOrphanRelationshipParts(zip: Awaited<ReturnType<typeof readPptx>>): number {
  let removed = 0;
  for (const filePath of Object.keys(zip.files).filter((name) => name.endsWith(".rels"))) {
    const ownerPart = ownerPartForRelationshipPart(filePath);
    if (ownerPart && !zip.file(ownerPart)) { zip.remove(filePath); removed += 1; }
  }
  return removed;
}

function getSlide(manifest: TemplateManifest, id: string): SlideManifest {
  const slide = manifest.slides.find((candidate) => candidate.templateId === id);
  if (!slide) throw new Error(`未知 templateId: ${id}`);
  return slide;
}

function escapeRegExp(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function escapeXml(value: string): string { return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
