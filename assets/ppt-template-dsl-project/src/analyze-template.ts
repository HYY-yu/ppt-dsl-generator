import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Command } from "commander";
import { analyzeTemplate } from "./pptx/analyze.js";
import { readPptx } from "./pptx/read.js";
import { buildInputSchema } from "./schema.js";
import { attachTemplateFingerprint } from "./template-contract.js";
import { lintTemplateManifest } from "./template-lint.js";

const program = new Command()
  .requiredOption("--template <path>", "PPTX 模板路径")
  .option("--out <dir>", "输出目录", "outputs");

program.parse();
const options = program.opts<{ template: string; out: string }>();

const templatePath = path.resolve(options.template);
const outDir = path.resolve(options.out);
await mkdir(outDir, { recursive: true });

console.info(`[analyze] 读取模板: ${templatePath}`);
const zip = await readPptx(templatePath);
const manifest = await attachTemplateFingerprint(await analyzeTemplate(zip, templatePath), templatePath);
const lint = lintTemplateManifest(manifest);
if (lint.errors.length) {
  throw new Error(`模板 DSL 检查失败:\n${lint.errors.map((error) => `- ${error}`).join("\n")}`);
}
const schema = buildInputSchema(manifest);

await writeFile(path.join(outDir, "template-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(path.join(outDir, "input.schema.json"), `${JSON.stringify(schema, null, 2)}\n`);
await writeFile(path.join(outDir, "template-lint.json"), `${JSON.stringify(lint, null, 2)}\n`);

const warningCount = manifest.slides.reduce((count, slide) => count + slide.warnings.length, 0);
console.info(`[analyze] slides=${manifest.slideCount} warnings=${warningCount}`);
console.info(`[analyze] 输出: ${outDir}`);
