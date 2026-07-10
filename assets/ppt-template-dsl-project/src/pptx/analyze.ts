import type JSZip from "jszip";
import { parseDsl } from "../dsl/parse.js";
import type {
  DslComponent,
  FieldManifest,
  ImageTarget,
  ListManifest,
  SlideManifest,
  TemplateManifest,
  TextTarget,
} from "../types.js";
import { maybeReadZipText, readZipText } from "./read.js";
import { parsePresentationSlideRelIds, parseRelationships, relationshipPartForOwner, resolveRelationshipTarget } from "./relationships.js";
import { readXfrm, textFromATags } from "./xml.js";

interface ShapeInfo {
  index: number;
  id?: string;
  name?: string;
  nameIndex?: number;
  text: string;
  x?: number;
  y?: number;
  cx?: number;
  cy?: number;
}

interface PicInfo {
  index: number;
  name?: string;
  nameIndex?: number;
  relId?: string;
  x?: number;
  y?: number;
  cx?: number;
  cy?: number;
}

export async function analyzeTemplate(zip: JSZip, sourceTemplate: string): Promise<TemplateManifest> {
  const presentationXml = await readZipText(zip, "ppt/presentation.xml");
  const presentationRels = await readZipText(zip, "ppt/_rels/presentation.xml.rels");
  const presentationRelationships = parseRelationships(presentationRels);
  const relationshipById = new Map(presentationRelationships.map((relationship) => [relationship.id, relationship]));
  const orderedSlides = parsePresentationSlideRelIds(presentationXml).map((relId, index) => {
    const relationship = relationshipById.get(relId);
    if (!relationship || !relationship.type.endsWith("/slide")) {
      throw new Error(`presentation.xml 的 ${relId} 没有有效 slide relationship`);
    }
    return {
      slideNumber: index + 1,
      slidePath: resolveRelationshipTarget("ppt/presentation.xml", relationship.target),
      relId,
    };
  });

  const slides: SlideManifest[] = [];
  for (const { slideNumber, slidePath, relId } of orderedSlides) {
    const slideXml = await readZipText(zip, slidePath);
    const notesPath = await findNotesSlidePath(zip, slidePath);
    const notesXml = notesPath ? await maybeReadZipText(zip, notesPath) : undefined;
    const notesText = notesXml ? textFromATags(notesXml) : "";
    const parsedDsl = parseDsl(notesText);
    const shapes = extractShapes(slideXml);
    const pics = await extractPics(
      zip,
      slidePath,
      slideXml,
      parsedDsl.components.filter((component) => component.kind === "image"),
    );
    const fields = buildFieldManifest(slidePath, parsedDsl.components, shapes, "slide");
    const lists = buildListManifest(slidePath, parsedDsl.lists, shapes);
    const warnings = [...parsedDsl.warnings];

    for (const field of [...fields, ...lists.flatMap((list) => list.itemFields)]) {
      if (!field.targets.length && field.component.kind === "text") {
        warnings.push(`未在第 ${slideNumber} 页找到文本锚点: ${field.key}`);
      }
    }

    slides.push({
      templateId: `slide_${String(slideNumber).padStart(3, "0")}`,
      slideNumber,
      slidePath,
      relId,
      pageType: parsedDsl.pageType,
      logic: parsedDsl.logic,
      fields,
      lists,
      images: pics,
      warnings,
    });
  }

  return {
    sourceTemplate,
    generatedAt: new Date().toISOString(),
    slideCount: slides.length,
    slides,
  };
}

async function findNotesSlidePath(zip: JSZip, slidePath: string): Promise<string | undefined> {
  const relsPath = relationshipPartForOwner(slidePath);
  const relsXml = await maybeReadZipText(zip, relsPath);
  if (!relsXml) return undefined;
  const relationship = parseRelationships(relsXml).find((candidate) => candidate.type.endsWith("/notesSlide"));
  return relationship ? resolveRelationshipTarget(slidePath, relationship.target) : undefined;
}

function buildFieldManifest(
  slidePath: string,
  components: DslComponent[],
  shapes: ShapeInfo[],
  scope: "slide" | "listItem",
): FieldManifest[] {
  return components
    .filter((component) => component.scope === scope && component.kind === "text" && component.label)
    .map((component) => ({
      key: component.label!,
      component,
      targets: findTextTargets(slidePath, shapes, component.label!),
    }));
}

function buildListManifest(slidePath: string, lists: DslComponent[], shapes: ShapeInfo[]): ListManifest[] {
  return lists.map((component, index) => {
    const list = component as ListManifest["component"];
    const itemFields = buildFieldManifest(slidePath, list.itemComponents, shapes, "listItem").map((field) => ({
      ...field,
      targets: sortRepeatedTargetsByLayout(field.targets, list),
    }));
    const maxItemsInTemplate = Math.max(0, ...itemFields.map((field) => field.targets.length));
    return {
      key: list.label ? `列表_${index + 1}_${list.label}` : `列表_${index + 1}`,
      component: list,
      maxItemsInTemplate,
      itemFields,
    };
  });
}

function sortRepeatedTargetsByLayout(targets: TextTarget[], list: ListManifest["component"]): TextTarget[] {
  if (targets.length <= 1) return targets;
  const positioned = targets.filter((target) => target.x !== undefined && target.y !== undefined);
  if (positioned.length !== targets.length) return targets;

  if (/时间轴|阶段|数字和箭头/.test(`${list.raw} ${list.label ?? ""}`)) {
    return [...targets].sort((a, b) => compareNumber(a.x, b.x) || compareNumber(a.y, b.y) || a.shapeIndex - b.shapeIndex);
  }

  const xs = positioned.map((target) => target.x!);
  const ys = positioned.map((target) => target.y!);
  const widths = positioned.map((target) => target.cx ?? 0).filter((value) => value > 0);
  const heights = positioned.map((target) => target.cy ?? 0).filter((value) => value > 0);
  const xRange = Math.max(...xs) - Math.min(...xs);
  const yRange = Math.max(...ys) - Math.min(...ys);
  const avgW = widths.reduce((sum, value) => sum + value, 0) / Math.max(widths.length, 1);
  const avgH = heights.reduce((sum, value) => sum + value, 0) / Math.max(heights.length, 1);

  const hasGridRows = xRange > avgW * 1.2 && yRange > avgH * 1.2;
  const horizontal = xRange >= yRange;
  return [...targets].sort((a, b) => {
    if (hasGridRows) return compareNumber(a.y, b.y) || compareNumber(a.x, b.x) || a.shapeIndex - b.shapeIndex;
    if (horizontal) return compareNumber(a.x, b.x) || compareNumber(a.y, b.y) || a.shapeIndex - b.shapeIndex;
    return compareNumber(a.y, b.y) || compareNumber(a.x, b.x) || a.shapeIndex - b.shapeIndex;
  });
}

function compareNumber(a: number | undefined, b: number | undefined): number {
  return (a ?? 0) - (b ?? 0);
}

function findTextTargets(slidePath: string, shapes: ShapeInfo[], placeholder: string): TextTarget[] {
  const normalizedPlaceholder = normalizeTextForMatch(placeholder);
  const matches: TextTarget[] = [];
  for (const shape of shapes) {
    if (!shape.text) continue;
    const normalizedText = normalizeTextForMatch(shape.text);
    const matched = normalizedPlaceholder.length <= 4
      ? normalizedText === normalizedPlaceholder
      : normalizedText.includes(normalizedPlaceholder);
    if (!matched) continue;
    matches.push({
      slidePath,
      shapeIndex: shape.index,
      shapeId: shape.id,
      shapeName: shape.name,
      shapeNameIndex: shape.nameIndex,
      placeholder,
      occurrence: matches.length,
      text: shape.text,
      x: shape.x,
      y: shape.y,
      cx: shape.cx,
      cy: shape.cy,
    });
  }
  return matches;
}

function extractShapes(slideXml: string): ShapeInfo[] {
  const nameCounts = new Map<string, number>();
  return [...slideXml.matchAll(/<p:sp\b[\s\S]*?<\/p:sp>/g)].map((match, index) => {
    const block = match[0];
    const id = block.match(/<p:cNvPr[^>]*\bid="([^"]+)"/)?.[1];
    const name = block.match(/<p:cNvPr[^>]*\bname="([^"]+)"/)?.[1];
    const nameIndex = name ? nameCounts.get(name) ?? 0 : undefined;
    if (name) nameCounts.set(name, (nameIndex ?? 0) + 1);
    return {
      index,
      id,
      name,
      nameIndex,
      text: textFromATags(block),
      ...readXfrm(block),
    };
  });
}

async function extractPics(
  zip: JSZip,
  slidePath: string,
  slideXml: string,
  imageComponents: DslComponent[],
): Promise<ImageTarget[]> {
  const relPath = relationshipPartForOwner(slidePath);
  const relXml = await maybeReadZipText(zip, relPath);
  const rels = new Map((relXml ? parseRelationships(relXml) : []).map((relationship) => [relationship.id, relationship.target]));
  const nameCounts = new Map<string, number>();
  return [...slideXml.matchAll(/<p:(pic|sp)\b[\s\S]*?<\/p:\1>/g)]
    .filter((match) => /r:embed="[^"]+"/.test(match[0]))
    .map((match, index) => {
      const block = match[0];
      const relId = block.match(/r:embed="([^"]+)"/)?.[1];
      const name = block.match(/<p:cNvPr[^>]*\bname="([^"]+)"/)?.[1];
      const nameIndex = name ? nameCounts.get(name) ?? 0 : undefined;
      if (name) nameCounts.set(name, (nameIndex ?? 0) + 1);
      return {
        slidePath,
        picIndex: index,
        shapeName: name,
        shapeNameIndex: nameIndex,
        relId,
        target: relId ? rels.get(relId) : undefined,
        ...readXfrm(block),
      };
    })
    .sort((a, b) => (a.y ?? 0) - (b.y ?? 0) || (a.x ?? 0) - (b.x ?? 0))
    .map((pic, index) => {
      const component = imageComponents.find((candidate) => candidate.index === index + 1) ?? imageComponents[index];
      return {
        ...pic,
        picIndex: index,
        key: `图片${index + 1}`,
        role: component?.imageRole ?? "content",
      };
    });
}

function normalizeTextForMatch(value: string): string {
  return value.replace(/\s+/g, "").replace(/[|｜]/g, "");
}
