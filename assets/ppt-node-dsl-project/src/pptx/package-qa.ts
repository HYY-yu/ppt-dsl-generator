import type JSZip from "jszip";
import { maybeReadZipText, readZipText } from "./read.js";
import {
  ownerPartForRelationshipPart,
  parsePresentationSlideRelIds,
  parseRelationships,
  resolveRelationshipTarget,
} from "./relationships.js";
import { findDanglingAnimationShapeIds } from "./animation.js";

export interface PackageQaResult {
  slideCount: number;
  slidePaths: string[];
  notesParts: number;
  orphanRelationships: string[];
  danglingRelationships: string[];
  invalidPresentationRelationships: string[];
  nonCanonicalRelationshipIds: string[];
  duplicateSlideCreationIds: string[];
  duplicateShapeCreationIds: string[];
  invalidAnimationTargets: string[];
  unreferencedImageRelationships: string[];
  missingImageRelationships: string[];
  nativeSvgEmbeddings: number;
  invalidSvgEmbeddings: string[];
  emptyPlaceholders: string[];
  placeholderSampleTexts: string[];
  errors: string[];
  warnings: string[];
}

export async function inspectPptxPackage(zip: JSZip): Promise<PackageQaResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const orphanRelationships: string[] = [];
  const danglingRelationships: string[] = [];
  const invalidPresentationRelationships: string[] = [];
  const nonCanonicalRelationshipIds: string[] = [];
  const duplicateSlideCreationIds: string[] = [];
  const duplicateShapeCreationIds: string[] = [];
  const invalidAnimationTargets: string[] = [];
  const unreferencedImageRelationships: string[] = [];
  const missingImageRelationships: string[] = [];
  const invalidSvgEmbeddings: string[] = [];
  let nativeSvgEmbeddings = 0;
  const emptyPlaceholders: string[] = [];
  const placeholderSampleTexts: string[] = [];
  const allPaths = Object.keys(zip.files);
  const notesPaths = allPaths.filter((name) => name.startsWith("ppt/notesSlides/") || name.startsWith("ppt/notesMasters/"));

  const contentTypes = await maybeReadZipText(zip, "[Content_Types].xml");
  if (/notesSlides|notesMasters/.test(contentTypes ?? "")) errors.push("[Content_Types].xml still references notes parts");
  const svgMediaPaths = allPaths.filter((name) => /^ppt\/media\/.*\.svg$/i.test(name));
  if (svgMediaPaths.length && !/<Default\b(?=[^>]*\bExtension="svg")(?=[^>]*\bContentType="image\/svg\+xml")[^>]*\/>/i.test(contentTypes ?? "")) {
    invalidSvgEmbeddings.push("[Content_Types].xml missing image/svg+xml registration");
  }
  const presentationXml = await readZipText(zip, "ppt/presentation.xml");
  if (/<p:notesMasterIdLst\b/.test(presentationXml)) errors.push("presentation.xml still contains p:notesMasterIdLst");

  for (const relsPath of allPaths.filter((name) => name.endsWith(".rels"))) {
    const ownerPart = ownerPartForRelationshipPart(relsPath);
    if (ownerPart && !zip.file(ownerPart)) {
      orphanRelationships.push(relsPath);
      continue;
    }
    const relsXml = await maybeReadZipText(zip, relsPath);
    if (!relsXml) continue;
    for (const relationship of parseRelationships(relsXml)) {
      if (!/^rId\d+$/.test(relationship.id)) {
        nonCanonicalRelationshipIds.push(`${relsPath}: ${relationship.id}`);
      }
      if (relationship.type.endsWith("/notesSlide") || relationship.type.endsWith("/notesMaster")) {
        errors.push(`${relsPath} still contains notes relationship ${relationship.id}`);
      }
      if (ownerPart === "ppt/presentation.xml" && relationship.type.endsWith("/slideLayout")) {
        invalidPresentationRelationships.push(`${relsPath}: ${relationship.id} -> ${relationship.target}`);
      }
      if (relationship.targetMode === "External") continue;
      const target = resolveRelationshipTarget(ownerPart, relationship.target);
      if (!zip.file(target)) danglingRelationships.push(`${relsPath} -> ${relationship.target}`);
    }
  }

  const slidePaths = await readOrderedSlidePaths(zip);
  const seenSlideCreationIds = new Map<string, string>();
  const seenShapeCreationIds = new Map<string, string>();
  for (const slidePath of slidePaths) {
    const slideXml = await readZipText(zip, slidePath);
    for (const match of slideXml.matchAll(/<p14:creationId\b[^>]*\bval="(\d+)"[^>]*\/>/g)) {
      const id = match[1];
      const firstSlide = seenSlideCreationIds.get(id);
      if (firstSlide) duplicateSlideCreationIds.push(`${slidePath}: ${id} (first seen in ${firstSlide})`);
      else seenSlideCreationIds.set(id, slidePath);
    }
    for (const match of slideXml.matchAll(/<a16:creationId\b[^>]*\bid="([^"]+)"[^>]*\/>/g)) {
      const id = match[1].toUpperCase();
      const firstSlide = seenShapeCreationIds.get(id);
      if (firstSlide) duplicateShapeCreationIds.push(`${slidePath}: ${id} (first seen in ${firstSlide})`);
      else seenShapeCreationIds.set(id, slidePath);
    }
    for (const shapeId of findDanglingAnimationShapeIds(slideXml)) {
      invalidAnimationTargets.push(`${slidePath}: spid=${shapeId}`);
    }
    inspectSlidePlaceholders(slidePath, slideXml, emptyPlaceholders, placeholderSampleTexts);
    const relsPath = `${slidePath.slice(0, slidePath.lastIndexOf("/") + 1)}_rels/${slidePath.slice(slidePath.lastIndexOf("/") + 1)}.rels`;
    const relsXml = await maybeReadZipText(zip, relsPath);
    const relationships = new Map((relsXml ? parseRelationships(relsXml) : []).map((relationship) => [relationship.id, relationship]));
    const referencedRelationshipIds = new Set(Array.from(
      slideXml.matchAll(/\b(?:r:id|r:embed|r:link|r:href|o:relid)="([^"]+)"/g),
      (match) => match[1],
    ));
    for (const relationship of relationships.values()) {
      if (relationship.type.endsWith("/image") && !referencedRelationshipIds.has(relationship.id)) {
        unreferencedImageRelationships.push(`${slidePath}: ${relationship.id} -> ${relationship.target}`);
      }
    }
    for (const match of slideXml.matchAll(/<a:blip\b[^>]*r:embed="([^"]+)"/g)) {
      const relId = match[1];
      const relationship = relationships.get(relId);
      if (!relationship) {
        missingImageRelationships.push(`${slidePath}: missing relationship ${relId}`);
        continue;
      }
      const target = resolveRelationshipTarget(slidePath, relationship.target);
      if (!zip.file(target)) missingImageRelationships.push(`${slidePath}: ${relId} -> ${relationship.target}`);
    }
    for (const match of slideXml.matchAll(/<a:blip\b[^>]*>[\s\S]*?<asvg:svgBlip\b[^>]*r:embed="([^"]+)"[^>]*\/>[\s\S]*?<\/a:blip>/g)) {
      nativeSvgEmbeddings += 1;
      const block = match[0];
      const svgRelId = match[1];
      const fallbackRelId = block.match(/^<a:blip\b[^>]*r:embed="([^"]+)"/)?.[1];
      const svgRelationship = relationships.get(svgRelId);
      if (!svgRelationship) {
        invalidSvgEmbeddings.push(`${slidePath}: missing SVG relationship ${svgRelId}`);
      } else {
        const svgTarget = resolveRelationshipTarget(slidePath, svgRelationship.target);
        if (!svgTarget.toLowerCase().endsWith(".svg") || !zip.file(svgTarget)) {
          invalidSvgEmbeddings.push(`${slidePath}: invalid SVG target ${svgRelId} -> ${svgRelationship.target}`);
        }
      }
      if (fallbackRelId) {
        invalidSvgEmbeddings.push(`${slidePath}: native SVG must not declare fallback relationship ${fallbackRelId}`);
      }
      const pictureStart = slideXml.lastIndexOf("<p:pic", match.index);
      const pictureEnd = slideXml.indexOf("</p:pic>", match.index);
      if (pictureStart >= 0 && pictureEnd >= 0) {
        const picture = slideXml.slice(pictureStart, pictureEnd + "</p:pic>".length);
        if (/<p:spPr\b[\s\S]*?<a:custGeom\b/.test(picture)) {
          invalidSvgEmbeddings.push(`${slidePath}: native SVG picture must not retain custom geometry`);
        }
      }
    }
  }

  if (notesPaths.length) errors.push(`notes parts remain: ${notesPaths.length}`);
  if (orphanRelationships.length) errors.push(`orphan relationship parts: ${orphanRelationships.length}`);
  if (danglingRelationships.length) errors.push(`dangling internal relationships: ${danglingRelationships.length}`);
  if (invalidPresentationRelationships.length) errors.push(`invalid Presentation -> SlideLayout relationships: ${invalidPresentationRelationships.length}`);
  if (nonCanonicalRelationshipIds.length) errors.push(`non-canonical relationship IDs: ${nonCanonicalRelationshipIds.length}`);
  if (duplicateSlideCreationIds.length) errors.push(`duplicate slide creation IDs: ${duplicateSlideCreationIds.length}`);
  if (duplicateShapeCreationIds.length) errors.push(`duplicate shape creation IDs: ${duplicateShapeCreationIds.length}`);
  if (invalidAnimationTargets.length) errors.push(`invalid animation targets: ${invalidAnimationTargets.length}`);
  if (unreferencedImageRelationships.length) errors.push(`unreferenced image relationships: ${unreferencedImageRelationships.length}`);
  if (missingImageRelationships.length) errors.push(`missing image relationships: ${missingImageRelationships.length}`);
  if (invalidSvgEmbeddings.length) errors.push(`invalid native SVG embeddings: ${invalidSvgEmbeddings.length}`);
  if (emptyPlaceholders.length) errors.push(`empty structural placeholders: ${emptyPlaceholders.length}`);
  if (placeholderSampleTexts.length) errors.push(`placeholder sample text remains: ${placeholderSampleTexts.length}`);

  return {
    slideCount: slidePaths.length,
    slidePaths,
    notesParts: notesPaths.length,
    orphanRelationships,
    danglingRelationships,
    invalidPresentationRelationships,
    nonCanonicalRelationshipIds,
    duplicateSlideCreationIds,
    duplicateShapeCreationIds,
    invalidAnimationTargets,
    unreferencedImageRelationships,
    missingImageRelationships,
    nativeSvgEmbeddings,
    invalidSvgEmbeddings,
    emptyPlaceholders,
    placeholderSampleTexts,
    errors,
    warnings,
  };
}

function inspectSlidePlaceholders(
  slidePath: string,
  slideXml: string,
  emptyPlaceholders: string[],
  placeholderSampleTexts: string[],
): void {
  for (const block of Array.from(slideXml.matchAll(/<p:sp\b[\s\S]*?<\/p:sp>/g), (match) => match[0])) {
    if (!/<p:ph\b/.test(block)) continue;
    const cNvPr = block.match(/<p:cNvPr\b[^>]*>/)?.[0] ?? "";
    const shapeId = cNvPr.match(/\bid="([^"]*)"/)?.[1] ?? "?";
    const shapeName = cNvPr.match(/\bname="([^"]*)"/)?.[1] ?? "";
    const text = [...block.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)]
      .map((match) => decodeXmlText(match[1]))
      .join("")
      .trim();
    const label = `${slidePath} shape ${shapeId}${shapeName ? ` (${shapeName})` : ""}`;
    if (!text) {
      emptyPlaceholders.push(label);
      continue;
    }
    if (isPlaceholderSampleText(text)) placeholderSampleTexts.push(`${label}: ${text}`);
  }
}

function decodeXmlText(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function isPlaceholderSampleText(text: string): boolean {
  return [
    /^click to add (title|subtitle|text|content)$/i,
    /^slide number$/i,
    /^date$/i,
    /^footer$/i,
    /^单击此处(?:编辑|添加)/,
    /^单击图标添加图片$/,
  ].some((pattern) => pattern.test(text));
}

export async function readOrderedSlidePaths(zip: JSZip): Promise<string[]> {
  const presentationXml = await readZipText(zip, "ppt/presentation.xml");
  const relsXml = await readZipText(zip, "ppt/_rels/presentation.xml.rels");
  const relationships = new Map(parseRelationships(relsXml).map((relationship) => [relationship.id, relationship]));
  return parsePresentationSlideRelIds(presentationXml).map((relId) => {
    const relationship = relationships.get(relId);
    if (!relationship) throw new Error(`presentation slide relationship missing: ${relId}`);
    return resolveRelationshipTarget("ppt/presentation.xml", relationship.target);
  });
}
