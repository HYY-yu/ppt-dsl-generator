import type JSZip from "jszip";
import { inspectPptxPackage } from "./package-qa.js";

export interface VerifyDeckReport {
  passed: boolean;
  slides: number;
  notesParts: number;
  danglingRelationships: string[];
  orphanRelationships: string[];
  invalidPresentationRelationships: string[];
  nonCanonicalRelationshipIds: string[];
  duplicateSlideCreationIds: string[];
  duplicateShapeCreationIds: string[];
  invalidAnimationTargets: string[];
  unreferencedImageRelationships: string[];
  unreferencedMediaParts: string[];
  nativeSvgEmbeddings: number;
  invalidSvgEmbeddings: string[];
  unreferencedSlideParts: string[];
  dslLeaks: string[];
  errors: string[];
}

export async function verifyDeckPackage(zip: JSZip): Promise<VerifyDeckReport> {
  const packageResult = await inspectPptxPackage(zip);
  const slideXmlPaths = Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name));
  const referencedSlides = new Set(packageResult.slidePaths);
  const unreferencedSlideParts = slideXmlPaths.filter((slidePath) => !referencedSlides.has(slidePath));
  const dslLeaks: string[] = [];
  for (const slidePath of slideXmlPaths) {
    const xml = await zip.file(slidePath)?.async("string");
    if (xml && /<p:cNvPr\b[^>]*\bname="\s*[@＠]/.test(xml)) dslLeaks.push(slidePath);
  }
  const errors = [
    ...packageResult.errors,
    ...unreferencedSlideParts.map((slidePath) => `${slidePath} 未被 presentation.xml 引用`),
    ...dslLeaks.map((slidePath) => `${slidePath} 仍含选择窗格 DSL 名称`),
  ];
  return {
    passed: errors.length === 0,
    slides: packageResult.slideCount,
    notesParts: packageResult.notesParts,
    danglingRelationships: packageResult.danglingRelationships,
    orphanRelationships: packageResult.orphanRelationships,
    invalidPresentationRelationships: packageResult.invalidPresentationRelationships,
    nonCanonicalRelationshipIds: packageResult.nonCanonicalRelationshipIds,
    duplicateSlideCreationIds: packageResult.duplicateSlideCreationIds,
    duplicateShapeCreationIds: packageResult.duplicateShapeCreationIds,
    invalidAnimationTargets: packageResult.invalidAnimationTargets,
    unreferencedImageRelationships: packageResult.unreferencedImageRelationships,
    unreferencedMediaParts: packageResult.unreferencedMediaParts,
    nativeSvgEmbeddings: packageResult.nativeSvgEmbeddings,
    invalidSvgEmbeddings: packageResult.invalidSvgEmbeddings,
    unreferencedSlideParts,
    dslLeaks,
    errors,
  };
}
