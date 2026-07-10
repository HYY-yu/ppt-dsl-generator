import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Automizer } from "pptx-automizer";
import type { ISlide } from "pptx-automizer";
import type { DeckInput, DeckInputSlide, SlideManifest, TemplateManifest } from "../types.js";
import { assertValidDeckInput } from "../validation.js";
import { applyDynamicLists, expandOverflowSlides } from "./layout.js";
import { readPptx } from "./read.js";
import {
  parsePresentationSlideRelIds,
  parseRelationships,
  relationshipPartForOwner,
  resolveRelationshipTarget,
} from "./relationships.js";
import { replaceShapeText } from "./xml.js";

const TEMPLATE_LABEL = "dsl_template";

export interface AutomizerGenerateOptions {
  templatePath: string;
  manifest: TemplateManifest;
  input: DeckInput;
  outPath: string;
}

export async function generateDeckWithAutomizer(options: AutomizerGenerateOptions): Promise<void> {
  await assertValidDeckInput(options.manifest, options.input, "raw");
  const expandedInput: DeckInput = {
    ...options.input,
    slides: expandOverflowSlides(options.manifest, options.input.slides),
  };
  await assertValidDeckInput(options.manifest, expandedInput, "expanded");

  const outDir = path.dirname(options.outPath);
  const outFile = path.basename(options.outPath);
  await mkdir(outDir, { recursive: true });

  const templateBuffer = await readFile(options.templatePath);
  const automizer = new Automizer({
    outputDir: `${outDir}${path.sep}`,
    removeExistingSlides: true,
    autoImportSlideMasters: true,
    assertRelatedContents: true,
    cleanup: true,
    compression: 6,
    verbosity: 1,
  });

  let pres = automizer.loadRoot(templateBuffer).load(templateBuffer, TEMPLATE_LABEL);

  for (const slideInput of expandedInput.slides) {
    const templateSlide = getTemplateSlide(options.manifest, slideInput.templateId);
    pres = pres.addSlide(TEMPLATE_LABEL, templateSlide.slideNumber, (slide: ISlide) => {
      void slide;
      // TODO(metrics): record successful template slide render by templateId/pageType.
    });
  }

  const summary = await pres.write(outFile);
  await patchTextFieldsAfterAutomizerWrite(options.outPath, options.manifest, expandedInput);
  console.info(
    `[generate] automizer status=${summary.status} slides=${summary.slides} images=${summary.images} masters=${summary.masters}`,
  );
}

function getTemplateSlide(manifest: TemplateManifest, templateId: string): SlideManifest {
  const slide = manifest.slides.find((candidate) => candidate.templateId === templateId);
  if (!slide) throw new Error(`未知 templateId: ${templateId}`);
  return slide;
}

async function applyImageReplacements(
  zip: Awaited<ReturnType<typeof readPptx>>,
  slidePath: string,
  slideXml: string,
  templateSlide: SlideManifest,
  input: DeckInputSlide,
  outputSlideIndex: number,
): Promise<string> {
  let xml = slideXml;
  const imageEntries = Object.entries(input.images ?? {});
  if (!imageEntries.length) return xml;

  const relPath = relationshipPartForOwner(slidePath);
  const relFile = zip.file(relPath);
  if (!relFile) {
    console.warn(`[generate] 图片替换跳过，缺少 slide rels: ${relPath}`);
    return xml;
  }

  let relXml = await relFile.async("string");
  for (const [key, sourcePath] of imageEntries) {
    const target = templateSlide.images.find((candidate) => candidate.key === key);
    const outputRelId = target ? imageRelIdFromSlideXml(xml, target.picIndex) : undefined;
    if (!target || !outputRelId) {
      console.warn(`[generate] 第 ${templateSlide.slideNumber} 页没有图片目标: ${key}`);
      continue;
    }

    const imageAsset = await loadImageForPptx(sourcePath);
    const imageBuffer = imageAsset.buffer;
    const extension = imageAsset.extension;
    const mediaName = `dsl-image-${outputSlideIndex + 1}-${target.picIndex + 1}${extension}`;
    zip.file(`ppt/media/${mediaName}`, imageBuffer);
    await ensureImageContentType(zip, extension);
    relXml = replaceRelationshipTarget(relXml, outputRelId, `../media/${mediaName}`);

    const imageSize = readImageDimensions(imageBuffer, extension);
    if (imageSize && target.cx && target.cy) {
      xml = applyCoverCrop(xml, outputRelId, imageSize.width / imageSize.height, target.cx / target.cy);
    }
  }

  zip.file(relPath, relXml);
  return xml;
}

function imageRelIdFromSlideXml(slideXml: string, imageIndex: number): string | undefined {
  const matches = [...slideXml.matchAll(/<a:blip\b[^>]*r:embed="([^"]+)"/g)];
  return matches[imageIndex]?.[1];
}

function replaceRelationshipTarget(relXml: string, relId: string, target: string): string {
  let replaced = false;
  const xml = relXml.replace(/<Relationship\b[^>]*\/>/g, (relationship) => {
    if (!new RegExp(`\\bId="${escapeRegExp(relId)}"`).test(relationship)) return relationship;
    replaced = true;
    return relationship.replace(/\bTarget="[^"]*"/, `Target="${target}"`);
  });
  if (!replaced) throw new Error(`图片 relationship 不存在: ${relId}`);
  return xml;
}

async function ensureImageContentType(zip: Awaited<ReturnType<typeof readPptx>>, extension: string): Promise<void> {
  if (extension === ".jpg" || extension === ".jpeg") return;
  const contentTypes = zip.file("[Content_Types].xml");
  if (!contentTypes) return;
  const defaultType = extension === ".png" ? "image/png" : extension === ".gif" ? "image/gif" : undefined;
  if (!defaultType) return;
  const xml = await contentTypes.async("string");
  const ext = extension.slice(1);
  if (new RegExp(`<Default\\b[^>]*Extension="${escapeRegExp(ext)}"`).test(xml)) return;
  zip.file("[Content_Types].xml", xml.replace("</Types>", `<Default Extension="${ext}" ContentType="${defaultType}"/></Types>`));
}

function applyCoverCrop(slideXml: string, relId: string, imageRatio: number, boxRatio: number): string {
  const crop = computeCoverCrop(imageRatio, boxRatio);
  const srcRect = `<a:srcRect l="${crop.l}" t="${crop.t}" r="${crop.r}" b="${crop.b}"/>`;
  return slideXml.replace(
    new RegExp(`(<a:blip\\b[^>]*r:embed="${escapeRegExp(relId)}"[\\s\\S]*?</a:blip>)(?:<a:srcRect[^>]*/>)?`),
    `$1${srcRect}`,
  );
}

function computeCoverCrop(imageRatio: number, boxRatio: number): { l: number; t: number; r: number; b: number } {
  if (!Number.isFinite(imageRatio) || !Number.isFinite(boxRatio) || imageRatio <= 0 || boxRatio <= 0) {
    return { l: 0, t: 0, r: 0, b: 0 };
  }
  if (imageRatio > boxRatio) {
    const visibleWidth = boxRatio / imageRatio;
    const crop = Math.round(((1 - visibleWidth) / 2) * 100000);
    return { l: crop, t: 0, r: crop, b: 0 };
  }
  const visibleHeight = imageRatio / boxRatio;
  const crop = Math.round(((1 - visibleHeight) / 2) * 100000);
  return { l: 0, t: crop, r: 0, b: crop };
}

function normalizeImageExtension(extension: string): ".jpeg" | ".jpg" | ".png" | ".gif" {
  const lower = extension.toLowerCase();
  if (lower === ".jpg" || lower === ".jpeg" || lower === ".png" || lower === ".gif") return lower;
  throw new Error(`不支持的图片格式: ${extension}`);
}

async function loadImageForPptx(sourcePath: string): Promise<{ buffer: Buffer; extension: ".jpeg" | ".jpg" | ".png" | ".gif" }> {
  const extension = normalizeImageExtension(path.extname(sourcePath));
  return { buffer: await readFile(sourcePath), extension };
}

function readImageDimensions(buffer: Buffer, extension: string): { width: number; height: number } | undefined {
  if (extension === ".png") return readPngDimensions(buffer);
  if (extension === ".jpg" || extension === ".jpeg") return readJpegDimensions(buffer);
  return undefined;
}

function readPngDimensions(buffer: Buffer): { width: number; height: number } | undefined {
  if (buffer.length < 24 || buffer.toString("ascii", 1, 4) !== "PNG") return undefined;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function readJpegDimensions(buffer: Buffer): { width: number; height: number } | undefined {
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) return undefined;
    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);
    if (marker >= 0xc0 && marker <= 0xc3) {
      return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
    }
    offset += 2 + length;
  }
  return undefined;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function patchTextFieldsAfterAutomizerWrite(
  outPath: string,
  manifest: TemplateManifest,
  input: DeckInput,
): Promise<void> {
  const zip = await readPptx(outPath);
  const slidePaths = await readOutputSlidePaths(zip);
  if (slidePaths.length !== input.slides.length) {
    console.warn(`[generate] 输出 slide 数与 input 不一致: output=${slidePaths.length} input=${input.slides.length}`);
  }

  for (let index = 0; index < input.slides.length; index += 1) {
    const slideInput = input.slides[index];
    const templateSlide = getTemplateSlide(manifest, slideInput.templateId);
    const outputSlidePath = slidePaths[index];
    const file = outputSlidePath ? zip.file(outputSlidePath) : undefined;
    if (!file) {
      console.warn(`[generate] 找不到输出 slide XML: index=${index} path=${outputSlidePath ?? "(空)"}`);
      continue;
    }
    let slideXml = await file.async("string");
    for (const [shapeIndex, value] of collectTextReplacements(templateSlide, slideInput)) {
      slideXml = replaceShapeText(slideXml, shapeIndex, value);
    }
    slideXml = applyDynamicLists(slideXml, templateSlide, slideInput);
    slideXml = await applyImageReplacements(zip, outputSlidePath, slideXml, templateSlide, slideInput, index);
    slideXml = sanitizeUnsupportedPatternFills(slideXml);
    zip.file(outputSlidePath, slideXml);
  }

  await removeSpeakerNotes(zip);
  await removeDanglingRelationships(zip);

  const buffer = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
  await writeFile(outPath, buffer);
}

function collectTextReplacements(templateSlide: SlideManifest, input: DeckInputSlide): Map<number, string> {
  const replacements = new Map<number, string>();
  for (const field of templateSlide.fields) {
    const value = input.fields?.[field.key];
    if (value === undefined) continue;
    for (const target of field.targets) replacements.set(target.shapeIndex, String(value));
  }

  for (const list of templateSlide.lists) {
    if (input.lists?.[list.key]) continue;
  }
  return replacements;
}

function sanitizeUnsupportedPatternFills(slideXml: string): string {
  return slideXml.replace(
    /<a:pattFill\b[\s\S]*?<\/a:pattFill>/g,
    '<a:solidFill><a:schemeClr val="accent1"/></a:solidFill>',
  );
}

async function readOutputSlidePaths(zip: Awaited<ReturnType<typeof readPptx>>): Promise<string[]> {
  const presentationXml = await zip.file("ppt/presentation.xml")?.async("string");
  const relsXml = await zip.file("ppt/_rels/presentation.xml.rels")?.async("string");
  if (!presentationXml || !relsXml) throw new Error("输出 PPTX 缺少 presentation.xml 或 presentation.xml.rels");

  const relTargets = new Map(
    parseRelationships(relsXml)
      .filter((relationship) => relationship.type.endsWith("/slide"))
      .map((relationship) => [relationship.id, resolveRelationshipTarget("ppt/presentation.xml", relationship.target)]),
  );
  return parsePresentationSlideRelIds(presentationXml)
    .map((relId) => relTargets.get(relId))
    .filter((value): value is string => Boolean(value));
}

async function removeDanglingRelationships(zip: Awaited<ReturnType<typeof readPptx>>): Promise<void> {
  for (const filePath of Object.keys(zip.files).filter((name) => name.endsWith(".rels"))) {
    const file = zip.file(filePath);
    if (!file) continue;
    const relsXml = await file.async("string");
    const relsDir = path.posix.dirname(filePath);
    const ownerDir = relsDir.endsWith("_rels") ? path.posix.dirname(relsDir) : relsDir;
    const cleanedXml = relsXml.replace(/<Relationship\b[^>]*\/>/g, (relationship) => {
      if (/TargetMode="External"/.test(relationship)) return relationship;
      const target = relationship.match(/\bTarget="([^"]+)"/)?.[1];
      if (!target || target.startsWith("#")) return relationship;
      const partPath = path.posix.normalize(path.posix.join(ownerDir, target));
      if (zip.file(partPath)) return relationship;
      console.warn(`[generate] 移除 dangling relationship: ${filePath} -> ${target}`);
      return "";
    });
    if (cleanedXml !== relsXml) zip.file(filePath, cleanedXml);
  }
}

async function removeSpeakerNotes(zip: Awaited<ReturnType<typeof readPptx>>): Promise<void> {
  for (const filePath of Object.keys(zip.files).filter((name) => name.endsWith(".rels"))) {
    const file = zip.file(filePath);
    if (!file) continue;
    const relsXml = await file.async("string");
    const cleanedXml = relsXml.replace(
      /<Relationship\b[^>]*Type="[^"]+\/(?:notesSlide|notesMaster)"[^>]*\/>/g,
      "",
    );
    if (cleanedXml !== relsXml) zip.file(filePath, cleanedXml);
  }

  for (const filePath of Object.keys(zip.files)) {
    if (
      filePath.startsWith("ppt/notesSlides/") ||
      filePath.startsWith("ppt/notesMasters/")
    ) {
      zip.remove(filePath);
    }
  }

  const contentTypes = zip.file("[Content_Types].xml");
  if (contentTypes) {
    const xml = await contentTypes.async("string");
    const cleanedXml = xml.replace(
      /<Override\b[^>]*PartName="\/ppt\/notes(?:Slides|Masters)\/[^"]+"[^>]*\/>/g,
      "",
    );
    if (cleanedXml !== xml) zip.file("[Content_Types].xml", cleanedXml);
  }

  const presentation = zip.file("ppt/presentation.xml");
  if (presentation) {
    const xml = await presentation.async("string");
    const cleanedXml = xml.replace(/<p:notesMasterIdLst>[\s\S]*?<\/p:notesMasterIdLst>/g, "");
    if (cleanedXml !== xml) zip.file("ppt/presentation.xml", cleanedXml);
  }

  removeOrphanRelationshipParts(zip);
}

function removeOrphanRelationshipParts(zip: Awaited<ReturnType<typeof readPptx>>): void {
  for (const filePath of Object.keys(zip.files).filter((name) => name.endsWith(".rels"))) {
    const ownerPart = ownerPartForRelationshipPart(filePath);
    if (!ownerPart) continue;
    if (!zip.file(ownerPart)) {
      console.warn(`[generate] 移除 orphan relationship part: ${filePath}`);
      zip.remove(filePath);
    }
  }
}

function ownerPartForRelationshipPart(relsPath: string): string | undefined {
  if (relsPath === "_rels/.rels") return undefined;
  const directory = path.posix.dirname(relsPath);
  const filename = path.posix.basename(relsPath, ".rels");
  if (!directory.endsWith("_rels")) return undefined;
  return path.posix.join(path.posix.dirname(directory), filename);
}
