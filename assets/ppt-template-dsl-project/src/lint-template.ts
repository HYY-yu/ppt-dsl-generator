import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Command } from "commander";
import { analyzeTemplate } from "./pptx/analyze.js";
import { readPptx } from "./pptx/read.js";
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

const manifest = await attachTemplateFingerprint(await analyzeTemplate(await readPptx(templatePath), templatePath), templatePath);
const result = lintTemplateManifest(manifest);
const reportPath = path.join(outDir, "template-lint.json");
await writeFile(reportPath, `${JSON.stringify({ templatePath, manifestVersion: manifest.manifestVersion, ...result }, null, 2)}\n`);
console.info(JSON.stringify({ reportPath, ...result }, null, 2));
if (result.errors.length) process.exitCode = 1;
