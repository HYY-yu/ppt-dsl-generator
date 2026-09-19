import { patchDataComponent, applyPalette } from "./data-components.js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { Automizer } from "pptx-automizer";
import type { ISlide } from "pptx-automizer";
import { parseGroupName } from "../dsl/parse.js";
import type { Box, ComponentManifest, DeckInput, ListItemManifest, ListManifest, NodeValue, SlideManifest, TemplateManifest } from "../types.js";
import { assertValidDeckInput } from "../validation.js";
import { assertManifestMatchesTemplate } from "../template-contract.js";
import { bindDeterministicNumbers, formatDeterministicNumber } from "../deck-numbers.js";
import { isRichTextValue } from "../rich-text.js";
import { flattenNodes, maxShapeId, parseSlideNodes, reassignShapeIds, renameFirstNode, replaceNodeRaw, replaceRichTextInNode, replaceTextInNode, setGroupBox, type XmlNode } from "./nodes.js";
import { readPptx } from "./read.js";
import { ownerPartForRelationshipPart, parsePresentationSlideRelIds, parseRelationships, relationshipPartForOwner, resolveRelationshipTarget } from "./relationships.js";
import { planDynamicListLayout } from "./layout.js";
import { repairDanglingAnimationTimeline } from "./animation.js";

const TEMPLATE_LABEL = "node_dsl_template";
const SVG_EXTENSION_URI = "{96DAC541-7B7A-43D3-8B79-37D633B846F1}";
const SVG_NAMESPACE = "http://schemas.microsoft.com/office/drawing/2016/SVG/main";

export async function generateDeck(options: { templatePath: string; manifest: TemplateManifest; input: DeckInput; outPath: string }): Promise<void> {
  await assertManifestMatchesTemplate(options.manifest, options.templatePath);
  const input = bindDeterministicNumbers(options.manifest, options.input);
  await assertValidDeckInput(options.manifest, input);
  await mkdir(path.dirname(options.outPath), { recursive: true });
  const templateBuffer = await readFile(options.templatePath);
  const automizer = new Automizer({
    outputDir: `${path.dirname(options.outPath)}${path.sep}`,
    removeExistingSlides: true,
    autoImportSlideMasters: true,
    assertRelatedContents: true,
    // pptx-automizer@0.8.2 may collect an unresolved SVG fallback relation as
    // `undefined` and dereference `.filename`. Keep its cleanup disabled and
    // perform deterministic package cleanup in patchGeneratedDeck instead.
    cleanup: false,
    compression: 6,
    verbosity: 1,
  });
  let presentation = automizer.loadRoot(templateBuffer).load(templateBuffer, TEMPLATE_LABEL);
  for (const inputSlide of input.slides) {
    const template = getSlide(options.manifest, inputSlide.templateId);
    presentation = presentation.addSlide(TEMPLATE_LABEL, template.slideNumber, (slide: ISlide) => { void slide; });
  }
  const summary = await presentation.write(path.basename(options.outPath));
  await patchGeneratedDeck(options.outPath, options.manifest, input);
  console.info(`[generate] status=${summary.status} outputSlides=${input.slides.length} automizerParts=${summary.slides}`);
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
    for (const node of flattenNodes(parseSlideNodes(xml)).filter(n => n.name === "runtime-page-number")) {
      xml = replaceNodeRaw(xml, node, replaceTextInNode(node.raw, String(slideIndex + 1).padStart(2, "0")));
    }
    xml = cleanDslNames(xml);
    zip.file(slidePath, xml);
  }
  if (input.palette) await applyPalette(zip, input.palette);
  const removedUnreferencedSlideParts = await removeUnreferencedSlideParts(zip, slidePaths);
  const removedUnreferencedImageRelationships = await removeUnreferencedSlideImageRelationships(zip);
  const removedNotesParts = await removeSpeakerNotes(zip);
  const removedOrphanRelationshipParts = removeOrphanRelationshipParts(zip);
  const invalidPresentationRelationships = await removeInvalidPresentationRelationships(zip);
  const normalizedRelationshipIds = await normalizeRelationshipIds(zip);
  const removedInvalidAnimationTimelines = await removeInvalidAnimationTimelines(zip);
  const regeneratedCreationIds = await regenerateDuplicateCreationIds(zip);
  const dangling = await removeDanglingRelationships(zip);
  const removedUnreferencedMediaParts = await removeUnreferencedMediaParts(zip);
  console.info(`[generate:cleanup] notesParts=${removedNotesParts} unreferencedSlideParts=${removedUnreferencedSlideParts} unreferencedMediaParts=${removedUnreferencedMediaParts.count} orphanRelationshipParts=${removedOrphanRelationshipParts} unreferencedImageRelationships=${removedUnreferencedImageRelationships.count} invalidPresentationRelationships=${invalidPresentationRelationships.count} normalizedRelationshipIds=${normalizedRelationshipIds.count} invalidAnimationTimelines=${removedInvalidAnimationTimelines.count} duplicateSlideCreationIds=${regeneratedCreationIds.slideCount} duplicateShapeCreationIds=${regeneratedCreationIds.shapeCount}`);
  if (removedUnreferencedImageRelationships.count > 0) {
    console.warn(`[generate:cleanup] unreferencedImageRelationshipsRemoved=${removedUnreferencedImageRelationships.count} samples=${removedUnreferencedImageRelationships.samples.join(",")}`);
  }
  if (invalidPresentationRelationships.count > 0) {
    console.warn(`[generate:cleanup] invalidPresentationRelationshipsRemoved=${invalidPresentationRelationships.count} samples=${invalidPresentationRelationships.samples.join(",")}`);
  }
  if (normalizedRelationshipIds.count > 0) {
    console.warn(`[generate:cleanup] nonCanonicalRelationshipIdsNormalized=${normalizedRelationshipIds.count} samples=${normalizedRelationshipIds.samples.join(",")}`);
  }
  if (removedInvalidAnimationTimelines.count > 0) {
    console.warn(`[generate:cleanup] invalidAnimationTimelinesRepaired=${removedInvalidAnimationTimelines.count} prunedBranches=${removedInvalidAnimationTimelines.prunedBranches} removedTimelines=${removedInvalidAnimationTimelines.removedTimelines} samples=${removedInvalidAnimationTimelines.samples.join(",")}`);
  }
  if (regeneratedCreationIds.slideCount + regeneratedCreationIds.shapeCount > 0) {
    console.warn(`[generate:cleanup] duplicateCreationIdsRegenerated=${regeneratedCreationIds.slideCount + regeneratedCreationIds.shapeCount} samples=${regeneratedCreationIds.samples.join(",")}`);
  }
  if (dangling.count > 0) {
    console.warn(`[generate:cleanup] danglingRelationshipsRemoved=${dangling.count} samples=${dangling.samples.join(",")}`);
  }
  if (removedUnreferencedMediaParts.count > 0) {
    console.warn(`[generate:cleanup] unreferencedMediaPartsRemoved=${removedUnreferencedMediaParts.count} samples=${removedUnreferencedMediaParts.samples.join(",")}`);
  }
  await writeFile(outPath, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } }));
}

export async function removeInvalidAnimationTimelines(zip: Awaited<ReturnType<typeof readPptx>>): Promise<{ count: number; prunedBranches: number; removedTimelines: number; samples: string[] }> {
  let count = 0;
  let prunedBranches = 0;
  let removedTimelines = 0;
  const samples: string[] = [];
  for (const slidePath of await outputSlidePaths(zip)) {
    const slideFile = zip.file(slidePath);
    if (!slideFile) continue;
    const slideXml = await slideFile.async("string");
    const repair = repairDanglingAnimationTimeline(slideXml);
    if (!repair.missingShapeIds.length) continue;
    zip.file(slidePath, repair.xml);
    count += 1;
    prunedBranches += repair.prunedBranches;
    if (repair.removedTimeline) removedTimelines += 1;
    if (samples.length < 10) samples.push(`${slidePath}:spid=${repair.missingShapeIds.join(",")}:${repair.removedTimeline ? "timeline-removed" : "branches-pruned"}`);
  }
  return { count, prunedBranches, removedTimelines, samples };
}

export async function normalizeRelationshipIds(zip: Awaited<ReturnType<typeof readPptx>>): Promise<{ count: number; samples: string[] }> {
  let count = 0;
  const samples: string[] = [];
  for (const relsPath of Object.keys(zip.files).filter((name) => name.endsWith(".rels")).sort()) {
    const relFile = zip.file(relsPath);
    if (!relFile) continue;
    let relXml = await relFile.async("string");
    const relationships = parseRelationships(relXml);
    const usedIds = new Set(relationships.filter((relationship) => /^rId\d+$/.test(relationship.id)).map((relationship) => relationship.id));
    const replacements = new Map<string, string>();
    let nextId = Math.max(0, ...Array.from(usedIds, (id) => Number(id.slice(3)))) + 1;
    for (const relationship of relationships) {
      if (/^rId\d+$/.test(relationship.id)) continue;
      const suffixCandidate = relationship.id.match(/^rId(\d+)-created$/)?.[1];
      let replacement = suffixCandidate ? `rId${suffixCandidate}` : `rId${nextId++}`;
      while (usedIds.has(replacement)) replacement = `rId${nextId++}`;
      usedIds.add(replacement);
      replacements.set(relationship.id, replacement);
      count += 1;
      if (samples.length < 10) samples.push(`${relsPath}:${relationship.id}->${replacement}`);
    }
    if (!replacements.size) continue;
    for (const [oldId, newId] of replacements) {
      relXml = relXml.replace(new RegExp(`(\\bId=")${escapeRegExp(oldId)}(")`, "g"), `$1${newId}$2`);
    }
    zip.file(relsPath, relXml);
    const ownerPath = ownerPartForRelationshipPart(relsPath);
    if (!ownerPath) continue;
    const ownerFile = zip.file(ownerPath);
    if (!ownerFile) continue;
    let ownerXml = await ownerFile.async("string");
    for (const [oldId, newId] of replacements) {
      ownerXml = ownerXml.replace(new RegExp(`(\\b(?:r:id|r:embed|r:link|r:href|o:relid)=")${escapeRegExp(oldId)}(")`, "g"), `$1${newId}$2`);
    }
    zip.file(ownerPath, ownerXml);
  }
  return { count, samples };
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
  const iconSides = canonicalListIconSides(list);
  logListIconSizing(slidePath, list, iconSides);
  for (let index = 0; index < items.length; index += 1) {
    for (const component of list.items[index]?.components ?? []) {
      const value = items[index][component.key] ?? (component.kind === "number" ? index + 1 : undefined);
      if (value !== undefined) output = await patchComponent(zip, slidePath, output, component.locator.shapeId, component, value, nextMedia, iconSides.get(component.key));
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
  const definedBoxes = groups.map((group) => group.box).filter((box): box is Box => Boolean(box));
  const fallbackBox = definedBoxes[0] ?? { x: 0, y: 0, cx: 1, cy: 1 };
  const sourceBoxes = groups.map((group) => group.box ?? fallbackBox);
  const layoutPlan = planDynamicListLayout(sourceBoxes, items.length, list.layout);
  console.info(`[generate:layout] slide=${slidePath} list=${list.key} mode=${layoutPlan.mode} sourceItems=${groups.length} outputItems=${items.length} patternPeriod=${layoutPlan.patternPeriod}`);
  const iconSides = canonicalListIconSides(list);
  logListIconSizing(slidePath, list, iconSides);
  let nextShapeIdValue = maxShapeId(xml) + 1;
  const nextShapeId = () => nextShapeIdValue++;
  const prepared: string[] = [];
  for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
    const source = groups[layoutPlan.sourceIndexes[itemIndex]] ?? groups[0];
    const sourceGroupIndex = parseGroupName(source.name)?.itemIndex ?? 1;
    const sourceManifestItem = list.items.find((item) => item.itemIndex === sourceGroupIndex) ?? list.items[0];
    let raw = source.raw;
    raw = await patchComponentsInsideGroup(zip, slidePath, raw, sourceManifestItem, items[itemIndex], itemIndex, nextMedia, iconSides);
    if (!groups[itemIndex]) raw = reassignShapeIds(raw, nextShapeId);
    raw = renameFirstNode(raw, `@${list.listIndex}@${itemIndex + 1}`);
    raw = setGroupBox(raw, layoutPlan.slots[itemIndex]);
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
  iconSides: ReadonlyMap<string, number>,
): Promise<string> {
  let output = raw;
  for (const contract of [...manifestItem.components].reverse()) {
    const value = values[contract.key] ?? (contract.kind === "number" ? itemIndex + 1 : undefined);
    if (value === undefined) continue;
    const freshNode = flattenNodes(parseSlideNodes(output)).find((node) => node.id === contract.locator.shapeId);
    if (!freshNode) throw new Error(`${slidePath} Group 内找不到 shapeId=${contract.locator.shapeId} (${contract.key})`);
    output = await patchComponentNode(zip, slidePath, output, freshNode, contract, value, nextMedia, iconSides.get(contract.key));
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
  iconSide?: number,
): Promise<string> {
  const node = flattenNodes(parseSlideNodes(xml)).find((candidate) => candidate.id === shapeId);
  if (!node) throw new Error(`${slidePath} 找不到 shapeId=${shapeId} (${component.key})`);
  return patchComponentNode(zip, slidePath, xml, node, component, value, nextMedia, iconSide);
}

async function patchComponentNode(
  zip: Awaited<ReturnType<typeof readPptx>>,
  slidePath: string,
  xml: string,
  node: XmlNode,
  component: ComponentManifest,
  value: NodeValue,
  nextMedia: () => number,
  iconSide?: number,
): Promise<string> {
  if (component.kind === "text" || component.kind === "number") {
    if (component.kind === "text" && isRichTextValue(value)) {
      const bulletParagraphs = value.paragraphs.filter((paragraph) => paragraph.list === "bullet").length;
      const numberedParagraphs = value.paragraphs.filter((paragraph) => paragraph.list === "number").length;
      const styledRuns = value.paragraphs.flatMap((paragraph) => paragraph.runs).filter((run) => run.bold || run.underline).length;
      console.info(`[generate:rich-text] slide=${slidePath} component=${component.key} paragraphs=${value.paragraphs.length} bulletParagraphs=${bulletParagraphs} numberedParagraphs=${numberedParagraphs} styledRuns=${styledRuns}`);
      return replaceNodeRaw(xml, node, replaceRichTextInNode(node.raw, value));
    }
    const text = component.kind === "number" ? formatDeterministicNumber(value, component.numberWidth) : String(value);
    return replaceNodeRaw(xml, node, replaceTextInNode(node.raw, text));
  }
  if (component.kind === "table" || component.kind === "chart") return patchDataComponent(zip, slidePath, xml, node, component, value);
  const targetNode = component.kind === "icon" && iconSide ? normalizeIconNodeBox(node, iconSide) : node;
  const sourcePath = typeof value === "object" && value !== null && "path" in value ? value.path : String(value);
  const serial = nextMedia();
  if (path.extname(sourcePath).toLowerCase() === ".svg") {
    const colorDecision = component.kind === "icon"
      ? resolveIconColor(xml, node.id)
      : { color: "#FFFFFF" as const, background: "not-applicable" as const };
    const svgMedia = await addMediaBuffer(zip, normalizeSvgForOffice(await readFile(sourcePath), colorDecision.color), ".svg", `node-dsl-${serial}.svg`);
    const existingSvgRelId = nativeSvgRelationshipId(targetNode.raw);
    const svgRelId = await addImageRelationship(zip, slidePath, svgMedia);
    console.info(`[generate:svg] mode=native-office2019 source=${path.basename(sourcePath)} media=${svgMedia} color=${colorDecision.color} background=${colorDecision.background}${"shapeId" in colorDecision && colorDecision.shapeId ? ` backgroundShapeId=${colorDecision.shapeId}` : ""}`);
    const picture = component.kind === "icon"
      ? pictureXml(targetNode, svgRelId, true)
      : targetNode.relId || existingSvgRelId ? targetNode.raw : pictureXml(targetNode, svgRelId);
    return replaceNodeRaw(xml, node, embedNativeSvgInPictureXml(picture, svgRelId));
  }
  const media = await addRasterMedia(zip, sourcePath, serial);
  const existingSvgRelId = nativeSvgRelationshipId(targetNode.raw);
  const relId = await addImageRelationship(zip, slidePath, media.name);
  const picture = component.kind === "icon"
    ? pictureXml(targetNode, relId, true)
    : targetNode.relId || existingSvgRelId ? targetNode.raw : pictureXml(targetNode, relId);
  const replacement = centerCropRasterPictureXml(
    removeNativeSvgFromPictureXml(picture, relId),
    media.width,
    media.height,
    targetNode.box,
  );
  return replaceNodeRaw(xml, node, replacement);
}

export function normalizeSvgForOffice(buffer: Buffer, color = "#FFFFFF"): Buffer {
  const source = buffer.toString("utf8");
  if (!/currentColor/i.test(source)) return buffer;
  return Buffer.from(source.replace(/currentColor/gi, color), "utf8");
}

export interface IconColorDecision {
  color: "#FFFFFF" | "#404040";
  background: "white" | "non-white" | "unknown";
  shapeId?: string;
}

export function resolveIconColor(xml: string, iconShapeId: string): IconColorDecision {
  const nodes = flattenNodes(parseSlideNodes(xml));
  const icon = nodes.find((candidate) => candidate.id === iconShapeId);
  if (!icon?.box) return { color: "#FFFFFF", background: "unknown" };
  const centerX = icon.box.x + icon.box.cx / 2;
  const centerY = icon.box.y + icon.box.cy / 2;
  const backgrounds = nodes
    .filter((candidate) => candidate.type === "sp" && candidate.id !== icon.id && candidate.start < icon.start && candidate.box)
    .filter((candidate) => {
      const box = candidate.box!;
      return centerX >= box.x && centerX <= box.x + box.cx && centerY >= box.y && centerY <= box.y + box.cy;
    })
    .sort((left, right) => right.start - left.start);
  for (const background of backgrounds) {
    const fill = solidFillToken(background.raw);
    if (!fill) continue;
    if (isWhiteFill(fill)) return { color: "#404040", background: "white", shapeId: background.id };
    return { color: "#FFFFFF", background: "non-white", shapeId: background.id };
  }
  return { color: "#FFFFFF", background: "unknown" };
}

export function canonicalListIconSides(list: ListManifest): Map<string, number> {
  const sides = new Map<string, number>();
  const firstItem = list.items.find((item) => item.itemIndex === 1) ?? list.items[0];
  for (const component of firstItem?.components ?? []) {
    if (component.kind !== "icon" || !component.locator.box) continue;
    const side = Math.min(component.locator.box.cx, component.locator.box.cy);
    if (side > 0) sides.set(component.key, side);
  }
  return sides;
}

export function squareBoxAtCenter(box: Box, side: number): Box {
  const normalizedSide = Math.max(1, Math.round(side));
  return {
    x: Math.round(box.x + (box.cx - normalizedSide) / 2),
    y: Math.round(box.y + (box.cy - normalizedSide) / 2),
    cx: normalizedSide,
    cy: normalizedSide,
  };
}

function normalizeIconNodeBox(node: XmlNode, side: number): XmlNode {
  if (!node.box) return node;
  const box = squareBoxAtCenter(node.box, side);
  const shapeProperties = node.raw.match(/<p:spPr\b[\s\S]*?<\/p:spPr>/)?.[0];
  if (!shapeProperties) return { ...node, box };
  const updatedShapeProperties = shapeProperties
    .replace(/<a:off\s+x="-?\d+"\s+y="-?\d+"\/>/, `<a:off x="${box.x}" y="${box.y}"/>`)
    .replace(/<a:ext\s+cx="\d+"\s+cy="\d+"\/>/, `<a:ext cx="${box.cx}" cy="${box.cy}"/>`);
  return { ...node, box, raw: node.raw.replace(shapeProperties, updatedShapeProperties) };
}

function logListIconSizing(slidePath: string, list: ListManifest, iconSides: ReadonlyMap<string, number>): void {
  if (!iconSides.size) return;
  const slots = Array.from(iconSides, ([key, side]) => `${key}:${side}`).join(",");
  console.info(`[generate:icons] slide=${slidePath} list=${list.key} standard=first-item squareSides=${slots}`);
}

function solidFillToken(shapeXml: string): string | undefined {
  const shapeProperties = shapeXml.match(/<p:spPr\b[\s\S]*?<\/p:spPr>/)?.[0];
  if (!shapeProperties) return undefined;
  const solidFill = shapeProperties.match(/<a:solidFill\b[\s\S]*?<\/a:solidFill>/)?.[0];
  if (!solidFill) return undefined;
  const scheme = solidFill.match(/<a:schemeClr\b[^>]*\bval="([^"]+)"/)?.[1];
  if (scheme) return `scheme:${scheme}`;
  const rgb = solidFill.match(/<a:srgbClr\b[^>]*\bval="([0-9A-Fa-f]{6})"/)?.[1];
  if (rgb) return `rgb:${rgb}`;
  const system = solidFill.match(/<a:sysClr\b[^>]*\blastClr="([0-9A-Fa-f]{6})"/)?.[1];
  if (system) return `rgb:${system}`;
  const preset = solidFill.match(/<a:prstClr\b[^>]*\bval="([^"]+)"/)?.[1];
  return preset ? `preset:${preset}` : undefined;
}

function isWhiteFill(fill: string): boolean {
  if (fill === "scheme:bg1" || fill === "scheme:lt1" || fill === "preset:white") return true;
  const rgb = fill.match(/^rgb:([0-9A-Fa-f]{6})$/)?.[1];
  if (!rgb) return false;
  return [0, 2, 4].every((offset) => Number.parseInt(rgb.slice(offset, offset + 2), 16) >= 245);
}

export async function addImageRelationship(zip: Awaited<ReturnType<typeof readPptx>>, slidePath: string, mediaName: string): Promise<string> {
  const relPath = relationshipPartForOwner(slidePath);
  const relFile = zip.file(relPath);
  if (!relFile) throw new Error(`${slidePath} 缺少 relationships`);
  let relXml = await relFile.async("string");
  const ids = [...relXml.matchAll(/\bId="rId(\d+)"/g)].map((match) => Number(match[1]));
  const relId = `rId${Math.max(0, ...ids) + 1}`;
  relXml = relXml.replace("</Relationships>", `<Relationship Id="${relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${mediaName}"/></Relationships>`);
  zip.file(relPath, relXml);
  return relId;
}

export async function removeUnreferencedSlideImageRelationships(zip: Awaited<ReturnType<typeof readPptx>>): Promise<{ count: number; samples: string[] }> {
  let count = 0;
  const samples: string[] = [];
  for (const slidePath of await outputSlidePaths(zip)) {
    const slideFile = zip.file(slidePath);
    const relPath = relationshipPartForOwner(slidePath);
    const relFile = zip.file(relPath);
    if (!slideFile || !relFile) continue;
    const slideXml = await slideFile.async("string");
    const referencedIds = new Set(Array.from(
      slideXml.matchAll(/\b(?:r:id|r:embed|r:link|r:href|o:relid)="([^"]+)"/g),
      (match) => match[1],
    ));
    const relXml = await relFile.async("string");
    const updated = relXml.replace(/<Relationship\b[^>]*\/>/g, (relationship) => {
      const id = relationship.match(/\bId="([^"]+)"/)?.[1];
      const type = relationship.match(/\bType="([^"]+)"/)?.[1];
      if (!id || !type?.endsWith("/image") || referencedIds.has(id)) return relationship;
      count += 1;
      if (samples.length < 10) {
        const target = relationship.match(/\bTarget="([^"]+)"/)?.[1] ?? "?";
        samples.push(`${slidePath}:${id}->${target}`);
      }
      return "";
    });
    if (updated !== relXml) zip.file(relPath, updated);
  }
  return { count, samples };
}

interface RasterMedia {
  name: string;
  width: number;
  height: number;
}

async function addRasterMedia(zip: Awaited<ReturnType<typeof readPptx>>, sourcePath: string, serial: number): Promise<RasterMedia> {
  const extension = path.extname(sourcePath).toLowerCase();
  const buffer = await readFile(sourcePath);
  const dimensions = rasterDimensions(buffer, extension);
  const name = await addMediaBuffer(zip, buffer, extension, `node-dsl-${serial}${extension}`);
  return { name, ...dimensions };
}

async function addMediaBuffer(
  zip: Awaited<ReturnType<typeof readPptx>>,
  buffer: Buffer,
  extension: string,
  name: string,
): Promise<string> {
  zip.file(`ppt/media/${name}`, buffer);
  await ensureContentType(zip, extension);
  return name;
}

async function ensureContentType(zip: Awaited<ReturnType<typeof readPptx>>, extension: string): Promise<void> {
  const mime = ({ ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".svg": "image/svg+xml" } as Record<string, string>)[extension];
  if (!mime) throw new Error(`不支持图片格式: ${extension}`);
  const file = zip.file("[Content_Types].xml");
  if (!file) return;
  const xml = await file.async("string");
  const ext = extension.slice(1);
  if (new RegExp(`<Default\\b[^>]*Extension="${escapeRegExp(ext)}"`, "i").test(xml)) return;
  zip.file("[Content_Types].xml", xml.replace("</Types>", `<Default Extension="${ext}" ContentType="${mime}"/></Types>`));
}

function nativeSvgRelationshipId(raw: string): string | undefined {
  return raw.match(/<asvg:svgBlip\b[^>]*\br:embed="([^"]+)"/)?.[1];
}

export function embedNativeSvgInPictureXml(raw: string, svgRelId: string): string {
  const extension = `<a:ext uri="${SVG_EXTENSION_URI}"><asvg:svgBlip xmlns:asvg="${SVG_NAMESPACE}" r:embed="${svgRelId}"/></a:ext>`;
  return rewritePictureBlip(raw, (original) => {
    let blip = original.replace(/^(<a:blip\b[^>]*?)\s+r:embed="[^"]*"/, "$1");
    if (/<asvg:svgBlip\b/.test(blip)) {
      return blip.replace(/(<asvg:svgBlip\b[^>]*\br:embed=")[^"]+("?)/, `$1${svgRelId}$2`);
    }
    if (/\/>$/.test(blip)) return `${blip.slice(0, -2)}><a:extLst>${extension}</a:extLst></a:blip>`;
    if (/<a:extLst\b/.test(blip)) return blip.replace("</a:extLst>", `${extension}</a:extLst>`);
    return blip.replace("</a:blip>", `<a:extLst>${extension}</a:extLst></a:blip>`);
  });
}

export function removeNativeSvgFromPictureXml(raw: string, rasterRelId?: string): string {
  return rewritePictureBlip(raw, (original) => {
    let blip = original
      .replace(/<a:ext\b[^>]*>(?:(?!<\/a:ext>)[\s\S])*?<asvg:svgBlip\b[^>]*\/>(?:(?!<\/a:ext>)[\s\S])*?<\/a:ext>/g, "")
      .replace(/<a:extLst\b[^>]*>\s*<\/a:extLst>/g, "");
    if (!rasterRelId) return blip;
    const openingTag = blip.match(/<a:blip\b[^>]*\/?\>/)?.[0] ?? "";
    if (/\br:embed="/.test(openingTag)) {
      return blip.replace(/(<a:blip\b[^>]*\br:embed=")[^"]+("?)/, `$1${rasterRelId}$2`);
    }
    return blip.replace(/<a:blip\b/, `<a:blip r:embed="${rasterRelId}"`);
  });
}

function rewritePictureBlip(raw: string, transform: (blip: string) => string): string {
  const blipPattern = /<a:blip\b[^>]*(?:\/>|>(?:(?!<\/a:blip>)[\s\S])*?<\/a:blip>)/;
  const fillPattern = /<([pa]):blipFill\b[^>]*>(?:(?!<\/\1:blipFill>)[\s\S])*?<\/\1:blipFill>/;
  if (fillPattern.test(raw)) {
    return raw.replace(fillPattern, (fill) => fill.replace(blipPattern, transform));
  }
  return raw.replace(blipPattern, transform);
}

export function centerCropRasterPictureXml(raw: string, sourceWidth: number, sourceHeight: number, targetBox?: Box): string {
  if (!targetBox || sourceWidth <= 0 || sourceHeight <= 0 || targetBox.cx <= 0 || targetBox.cy <= 0) return raw;
  const sourceAspect = sourceWidth / sourceHeight;
  const targetAspect = targetBox.cx / targetBox.cy;
  let left = 0;
  let top = 0;
  let right = 0;
  let bottom = 0;
  if (sourceAspect > targetAspect) {
    left = right = cropFractionToOOXML((1 - targetAspect / sourceAspect) / 2);
  } else if (sourceAspect < targetAspect) {
    top = bottom = cropFractionToOOXML((1 - sourceAspect / targetAspect) / 2);
  }
  const sourceRect = left || top || right || bottom
    ? `<a:srcRect l="${left}" t="${top}" r="${right}" b="${bottom}"/>`
    : "";
  const stretch = "<a:stretch><a:fillRect/></a:stretch>";
  return raw.replace(/(<([pa]):blipFill\b[^>]*>)([\s\S]*?)(<\/\2:blipFill>)/, (_full, open: string, _prefix: string, body: string, close: string) => {
    const cleaned = body
      .replace(/<a:srcRect\b[^>]*(?:\/>|>[\s\S]*?<\/a:srcRect>)/g, "")
      .replace(/<a:stretch\b[^>]*>[\s\S]*?<\/a:stretch>/g, "")
      .replace(/<a:tile\b[^>]*(?:\/>|>[\s\S]*?<\/a:tile>)/g, "");
    const filled = cleaned.replace(/(<a:blip\b[^>]*(?:\/>|>[\s\S]*?<\/a:blip>))/, `$1${sourceRect}${stretch}`);
    return `${open}${filled}${close}`;
  });
}

function cropFractionToOOXML(value: number): number {
  return Math.min(49_999, Math.max(0, Math.round(value * 100_000)));
}

export function rasterDimensions(buffer: Buffer, extension: string): { width: number; height: number } {
  const normalized = extension.toLowerCase();
  if (normalized === ".png" && buffer.length >= 24 && buffer.subarray(1, 4).toString("ascii") === "PNG") {
    return checkedRasterDimensions(buffer.readUInt32BE(16), buffer.readUInt32BE(20), extension);
  }
  if (normalized === ".gif" && buffer.length >= 10 && buffer.subarray(0, 3).toString("ascii") === "GIF") {
    return checkedRasterDimensions(buffer.readUInt16LE(6), buffer.readUInt16LE(8), extension);
  }
  if ((normalized === ".jpg" || normalized === ".jpeg") && buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    const startOfFrame = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
    let offset = 2;
    while (offset + 8 < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      while (offset < buffer.length && buffer[offset] === 0xff) offset += 1;
      const marker = buffer[offset++];
      if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 1 >= buffer.length) break;
      const segmentLength = buffer.readUInt16BE(offset);
      if (segmentLength < 2 || offset + segmentLength > buffer.length) break;
      if (startOfFrame.has(marker) && segmentLength >= 7) {
        return checkedRasterDimensions(buffer.readUInt16BE(offset + 5), buffer.readUInt16BE(offset + 3), extension);
      }
      offset += segmentLength;
    }
  }
  throw new Error(`无法读取图片尺寸: ${extension}`);
}

function checkedRasterDimensions(width: number, height: number, extension: string): { width: number; height: number } {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`图片尺寸无效: ${extension} ${width}x${height}`);
  }
  return { width, height };
}

export function pictureXml(node: XmlNode, relId: string, cleanGeometry = false): string {
  const box = node.box ?? { x: 0, y: 0, cx: 1, cy: 1 };
  const fallbackTransform = `<a:xfrm><a:off x="${box.x}" y="${box.y}"/><a:ext cx="${box.cx}" cy="${box.cy}"/></a:xfrm>`;
  const transform = node.raw.match(/<a:xfrm\b[\s\S]*?<\/a:xfrm>|<a:xfrm\b[^>]*\/>/)?.[0] ?? fallbackTransform;
  const shapeProperties = cleanGeometry
    ? `<p:spPr>${transform}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></p:spPr>`
    : node.raw.match(/<p:spPr\b[\s\S]*?<\/p:spPr>/)?.[0]
      ?? `<p:spPr>${fallbackTransform}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>`;
  return `<p:pic><p:nvPicPr><p:cNvPr id="${node.id}" name="${escapeXml(node.name)}"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>${shapeProperties}</p:pic>`;
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

export async function removeUnreferencedSlideParts(
  zip: Awaited<ReturnType<typeof readPptx>>,
  referencedSlidePaths: readonly string[],
): Promise<number> {
  const referenced = new Set(referencedSlidePaths);
  const removedPaths = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name) && !referenced.has(name))
    .sort();
  for (const slidePath of removedPaths) {
    zip.remove(slidePath);
    zip.remove(relationshipPartForOwner(slidePath));
  }
  const contentTypes = zip.file("[Content_Types].xml");
  if (contentTypes && removedPaths.length) {
    let xml = await contentTypes.async("string");
    for (const slidePath of removedPaths) {
      xml = xml.replace(new RegExp(`<Override\\b[^>]*PartName="/${escapeRegExp(slidePath)}"[^>]*/>`, "g"), "");
    }
    zip.file("[Content_Types].xml", xml);
  }
  return removedPaths.length;
}

export async function removeUnreferencedMediaParts(
  zip: Awaited<ReturnType<typeof readPptx>>,
): Promise<{ count: number; samples: string[] }> {
  const referenced = new Set<string>();
  for (const relsPath of Object.keys(zip.files).filter((name) => name.endsWith(".rels"))) {
    const relFile = zip.file(relsPath);
    if (!relFile) continue;
    const ownerPart = ownerPartForRelationshipPart(relsPath);
    for (const relationship of parseRelationships(await relFile.async("string"))) {
      if (relationship.targetMode === "External") continue;
      referenced.add(resolveRelationshipTarget(ownerPart, relationship.target));
    }
  }
  const removedPaths = Object.keys(zip.files)
    .filter((name) => /^ppt\/media\/[^/]+$/.test(name) && !referenced.has(name))
    .sort();
  for (const mediaPath of removedPaths) zip.remove(mediaPath);
  const contentTypes = zip.file("[Content_Types].xml");
  if (contentTypes && removedPaths.length) {
    let xml = await contentTypes.async("string");
    for (const mediaPath of removedPaths) {
      xml = xml.replace(new RegExp(`<Override\\b[^>]*PartName="/${escapeRegExp(mediaPath)}"[^>]*/>`, "g"), "");
    }
    zip.file("[Content_Types].xml", xml);
  }
  return { count: removedPaths.length, samples: removedPaths.slice(0, 10) };
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

export async function removeInvalidPresentationRelationships(zip: Awaited<ReturnType<typeof readPptx>>): Promise<{ count: number; samples: string[] }> {
  const relsPath = "ppt/_rels/presentation.xml.rels";
  const file = zip.file(relsPath);
  if (!file) return { count: 0, samples: [] };
  const xml = await file.async("string");
  let count = 0;
  const samples: string[] = [];
  const updated = xml.replace(/<Relationship\b(?=[^>]*\bType="[^"]+\/slideLayout")[^>]*\/>/g, (relationship) => {
    count += 1;
    if (samples.length < 5) {
      const id = relationship.match(/\bId="([^"]+)"/)?.[1] ?? "?";
      const target = relationship.match(/\bTarget="([^"]+)"/)?.[1] ?? "?";
      samples.push(`${id}->${target}`);
    }
    return "";
  });
  if (count > 0) zip.file(relsPath, updated);
  return { count, samples };
}

export async function regenerateDuplicateCreationIds(zip: Awaited<ReturnType<typeof readPptx>>): Promise<{ slideCount: number; shapeCount: number; samples: string[] }> {
  const seenSlideIds = new Set<string>();
  const seenShapeIds = new Set<string>();
  const samples: string[] = [];
  let slideCount = 0;
  let shapeCount = 0;
  for (const slidePath of await outputSlidePaths(zip)) {
    const file = zip.file(slidePath);
    if (!file) continue;
    let xml = await file.async("string");
    xml = xml.replace(/(<p14:creationId\b[^>]*\bval=")(\d+)("[^>]*\/>)/g, (full, prefix: string, id: string, suffix: string) => {
      if (!seenSlideIds.has(id)) {
        seenSlideIds.add(id);
        return full;
      }
      const replacement = nextSlideCreationId(seenSlideIds);
      seenSlideIds.add(replacement);
      slideCount += 1;
      if (samples.length < 8) samples.push(`${slidePath}:slide:${id}->${replacement}`);
      return `${prefix}${replacement}${suffix}`;
    });
    xml = xml.replace(/(<a16:creationId\b[^>]*\bid=")([^"]+)("[^>]*\/>)/g, (full, prefix: string, id: string, suffix: string) => {
      const normalized = id.toUpperCase();
      if (!seenShapeIds.has(normalized)) {
        seenShapeIds.add(normalized);
        return full;
      }
      const replacement = nextShapeCreationId(seenShapeIds);
      seenShapeIds.add(replacement);
      shapeCount += 1;
      if (samples.length < 8) samples.push(`${slidePath}:shape:${id}->${replacement}`);
      return `${prefix}${replacement}${suffix}`;
    });
    zip.file(slidePath, xml);
  }
  return { slideCount, shapeCount, samples };
}

function nextSlideCreationId(seen: Set<string>): string {
  let id = "0";
  while (id === "0" || seen.has(id)) id = String(parseInt(randomUUID().replace(/-/g, "").slice(0, 8), 16) >>> 0);
  return id;
}

function nextShapeCreationId(seen: Set<string>): string {
  let id = "";
  while (!id || seen.has(id)) id = `{${randomUUID().toUpperCase()}}`;
  return id;
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
