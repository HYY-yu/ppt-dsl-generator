import path from "node:path";
import { Command } from "commander";
import { inspectPptxPackage } from "./pptx/package-qa.js";
import { readPptx } from "./pptx/read.js";

const program = new Command().requiredOption("--pptx <path>");
program.parse();
const options = program.opts<{ pptx: string }>();
const zip = await readPptx(path.resolve(options.pptx));
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
const report = {
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
console.info(JSON.stringify(report, null, 2));
if (errors.length) process.exitCode = 1;
