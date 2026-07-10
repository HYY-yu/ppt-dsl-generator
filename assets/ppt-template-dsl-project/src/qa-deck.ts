import { execFile } from "node:child_process";
import { access, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Command } from "commander";
import { expandOverflowSlides } from "./pptx/layout.js";
import { inspectPptxPackage } from "./pptx/package-qa.js";
import { parseRelationships, relationshipPartForOwner } from "./pptx/relationships.js";
import { readPptx } from "./pptx/read.js";
import type { DeckInput, TemplateManifest } from "./types.js";
import { assertManifestMatchesTemplate } from "./template-contract.js";
import { validateDeckInput } from "./validation.js";
import { buildVisualReviewTemplate, validateVisualReview } from "./qa/visual-review.js";

interface LayoutReport {
  passed: boolean;
  geometryFailures: unknown[];
  textCollisions: unknown[];
  textCollisionCandidates: number;
}

const execFileAsync = promisify(execFile);
const program = new Command()
  .requiredOption("--template <path>", "原始 DSL 模板 PPTX")
  .requiredOption("--manifest <path>", "template-manifest.json")
  .requiredOption("--input <path>", "DeckInput JSON")
  .requiredOption("--pptx <path>", "生成后的 PPTX")
  .requiredOption("--out <dir>", "QA 输出目录")
  .option("--python <path>", "用于渲染工具的 Python；默认 python3 或 PPT_DSL_PYTHON")
  .option("--tools-dir <path>", "覆盖内置 qa_tools 的自定义渲染工具目录")
  .option("--renderer <renderer>", "auto、powerpoint 或 fallback", "auto")
  .option("--visual-review <path>", "逐页视觉审查结果 JSON")
  .option("--require-visual-review", "要求所有页面完成视觉审查后才可通过", false);

program.parse();
const options = program.opts<{
  template: string;
  manifest: string;
  input: string;
  pptx: string;
  out: string;
  python?: string;
  toolsDir?: string;
  renderer: "auto" | "powerpoint" | "fallback";
  visualReview?: string;
  requireVisualReview: boolean;
}>();
if (!(["auto", "powerpoint", "fallback"] as string[]).includes(options.renderer)) {
  throw new Error(`未知 renderer: ${options.renderer}`);
}

const templatePath = path.resolve(options.template);
const manifestPath = path.resolve(options.manifest);
const inputPath = path.resolve(options.input);
const pptxPath = path.resolve(options.pptx);
const outDir = path.resolve(options.out);
await mkdir(outDir, { recursive: true });

const errors: string[] = [];
const warnings: string[] = [];
const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as TemplateManifest;
const input = JSON.parse(await readFile(inputPath, "utf8")) as DeckInput;
try {
  await assertManifestMatchesTemplate(manifest, templatePath);
} catch (error) {
  errors.push(`manifest/template: ${error instanceof Error ? error.message : String(error)}`);
}
const rawValidation = await validateDeckInput(manifest, input, "raw");
errors.push(...rawValidation.errors.map((error) => `raw input: ${error}`));
warnings.push(...rawValidation.warnings.map((warning) => `raw input: ${warning}`));

let expandedInput: DeckInput = input;
try {
  expandedInput = { ...input, slides: expandOverflowSlides(manifest, input.slides) };
} catch (error) {
  errors.push(`pagination: ${error instanceof Error ? error.message : String(error)}`);
}
const expandedValidation = await validateDeckInput(manifest, expandedInput, "expanded");
errors.push(...expandedValidation.errors.map((error) => `expanded input: ${error}`));
warnings.push(...expandedValidation.warnings.map((warning) => `expanded input: ${warning}`));

try {
  const pptxStat = await stat(pptxPath);
  if (!pptxStat.isFile() || pptxStat.size === 0) errors.push("generated PPTX is missing or empty");
} catch {
  errors.push(`generated PPTX does not exist: ${pptxPath}`);
}

const zip = await readPptx(pptxPath);
const packageQa = await inspectPptxPackage(zip);
errors.push(...packageQa.errors.map((error) => `package: ${error}`));
warnings.push(...packageQa.warnings.map((warning) => `package: ${warning}`));
if (packageQa.slideCount !== expandedInput.slides.length) {
  errors.push(`slide count mismatch: package=${packageQa.slideCount} expandedInput=${expandedInput.slides.length}`);
}

const imageReplacementErrors = await verifyImageReplacements(zip, packageQa.slidePaths, expandedInput);
errors.push(...imageReplacementErrors);

const python = options.python ? path.resolve(options.python) : await discoverPython();
const toolsDir = options.toolsDir ? path.resolve(options.toolsDir) : await discoverPresentationTools();
const renderDir = path.join(outDir, "rendered-slides");
const montagePath = path.join(outDir, "montage.png");
const visualReviewTemplatePath = path.join(outDir, "visual-review.template.json");
let renderedSlides = 0;
let overflowPassed = false;
let renderBackend = "unknown";
let renderAttempts: unknown[] = [];
let layoutReport: LayoutReport | undefined = undefined;

try {
  await runPython(python, path.join(toolsDir, "render_slides.py"), [
    pptxPath,
    "--output-dir", renderDir,
    "--renderer", options.renderer,
  ]);
  const renderReport = JSON.parse(await readFile(path.join(renderDir, "render-report.json"), "utf8")) as {
    renderer?: string;
    attempts?: unknown[];
  };
  renderBackend = renderReport.renderer ?? renderBackend;
  renderAttempts = renderReport.attempts ?? renderAttempts;
  renderedSlides = (await readdir(renderDir)).filter((name) => /^slide-\d+\.png$/.test(name)).length;
  if (renderedSlides !== packageQa.slideCount) {
    errors.push(`rendered slide count mismatch: rendered=${renderedSlides} package=${packageQa.slideCount}`);
  }
  const layoutReportPath = path.join(outDir, "layout-report.json");
  await runPython(python, path.join(toolsDir, "slides_test.py"), [pptxPath, "--report-json", layoutReportPath]);
  layoutReport = JSON.parse(await readFile(layoutReportPath, "utf8")) as LayoutReport;
  if (layoutReport.textCollisionCandidates > 0) {
    warnings.push(`layout: ${layoutReport.textCollisionCandidates} text collision candidate(s) require visual review`);
  }
  overflowPassed = true;
  await runPython(python, path.join(toolsDir, "create_montage.py"), [
    "--input-dir", renderDir,
    "--output-file", montagePath,
  ]);
} catch (error) {
  errors.push(`render QA: ${error instanceof Error ? error.message : String(error)}`);
}

await writeFile(visualReviewTemplatePath, `${JSON.stringify(buildVisualReviewTemplate(renderedSlides || packageQa.slideCount), null, 2)}\n`);
const automatedPassed = errors.length === 0;
const visualReview = await inspectVisualReview(options.visualReview, options.requireVisualReview, packageQa.slideCount);
errors.push(...visualReview.errors);

const report = {
  passed: errors.length === 0,
  automatedPassed,
  templatePath,
  manifestPath,
  inputPath,
  pptxPath,
  renderDir,
  montagePath,
  visualReviewTemplatePath,
  rawValidation,
  expandedValidation,
  package: packageQa,
  rendering: { requestedRenderer: options.renderer, renderer: renderBackend, attempts: renderAttempts, renderedSlides, overflowPassed },
  layout: layoutReport,
  visualReview,
  provenance: expandedInput.slides.map((slide, index) => ({
    slide: index + 1,
    templateId: slide.templateId,
    sourceRefs: slide.sourceRefs ?? [],
  })),
  errors,
  warnings,
  generatedAt: new Date().toISOString(),
};
const reportPath = path.join(outDir, "qa-report.json");
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.info(JSON.stringify({ passed: report.passed, reportPath, montagePath, errors, warnings }, null, 2));
if (!report.passed) process.exitCode = 1;

async function verifyImageReplacements(
  pptxZip: Awaited<ReturnType<typeof readPptx>>,
  slidePaths: string[],
  deck: DeckInput,
): Promise<string[]> {
  const failures: string[] = [];
  for (const [slideIndex, slideInput] of deck.slides.entries()) {
    const outputSlidePath = slidePaths[slideIndex];
    if (!outputSlidePath) continue;
    const slideXml = await pptxZip.file(outputSlidePath)?.async("string");
    const relsXml = await pptxZip.file(relationshipPartForOwner(outputSlidePath))?.async("string");
    if (!slideXml || !relsXml) continue;
    const rels = new Map(parseRelationships(relsXml).map((relationship) => [relationship.id, relationship]));
    const blips = [...slideXml.matchAll(/<a:blip\b[^>]*r:embed="([^"]+)"/g)].map((match) => match[1]);
    for (const key of Object.keys(slideInput.images ?? {})) {
      const target = manifest.slides.find((slide) => slide.templateId === slideInput.templateId)?.images.find((image) => image.key === key);
      const relId = target ? blips[target.picIndex] : undefined;
      const relationship = relId ? rels.get(relId) : undefined;
      if (!relationship || !path.posix.basename(relationship.target).startsWith("dsl-image-")) {
        failures.push(`image replacement: slide ${slideIndex + 1} ${key} was not bound to an output media relationship`);
      }
    }
    for (const key of slideInput.approvedTemplateImages ?? []) {
      const target = manifest.slides.find((slide) => slide.templateId === slideInput.templateId)?.images.find((image) => image.key === key);
      const relId = target ? blips[target.picIndex] : undefined;
      if (!relId || !rels.get(relId)) {
        failures.push(`approved template image: slide ${slideIndex + 1} ${key} is missing from the output package`);
      }
    }
  }
  return failures;
}

async function inspectVisualReview(
  reviewPath: string | undefined,
  required: boolean,
  slideCount: number,
): Promise<{ required: boolean; path?: string; provided: boolean; passed: boolean; errors: string[] }> {
  if (!reviewPath) {
    return {
      required,
      provided: false,
      passed: !required,
      errors: required ? ["visual review is required; complete visual-review.template.json and pass --visual-review"] : [],
    };
  }
  try {
    const resolvedPath = path.resolve(reviewPath);
    const review = JSON.parse(await readFile(resolvedPath, "utf8"));
    const reviewErrors = validateVisualReview(review, slideCount);
    return { required, path: resolvedPath, provided: true, passed: reviewErrors.length === 0, errors: reviewErrors.map((error) => `visual review: ${error}`) };
  } catch (error) {
    return {
      required,
      path: path.resolve(reviewPath),
      provided: true,
      passed: false,
      errors: [`visual review: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
}

async function discoverPython(): Promise<string> {
  return process.env.PPT_DSL_PYTHON || "python3";
}

async function discoverPresentationTools(): Promise<string> {
  const configured = options.toolsDir || process.env.PPT_DSL_PRESENTATION_TOOLS_DIR;
  const candidate = configured
    ? path.resolve(configured)
    : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../qa_tools");
  for (const script of ["render_slides.py", "slides_test.py", "create_montage.py"]) {
    await access(path.join(candidate, script));
  }
  return candidate;
}

async function runPython(pythonPath: string, scriptPath: string, args: string[]): Promise<void> {
  const result = await execFileAsync(pythonPath, [scriptPath, ...args], { maxBuffer: 20 * 1024 * 1024 });
  if (result.stdout.trim()) console.info(result.stdout.trim());
  if (result.stderr.trim()) console.warn(result.stderr.trim());
}
