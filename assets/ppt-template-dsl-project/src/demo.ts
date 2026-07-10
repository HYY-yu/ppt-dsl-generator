import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Command } from "commander";
import { generateDeckWithAutomizer } from "./pptx/automizer-generate.js";
import { analyzeTemplate } from "./pptx/analyze.js";
import { readPptx } from "./pptx/read.js";
import { buildInputSchema } from "./schema.js";
import { attachTemplateFingerprint } from "./template-contract.js";
import { lintTemplateManifest } from "./template-lint.js";
import type { DeckInput } from "./types.js";
import { assertValidDeckInput } from "./validation.js";

const program = new Command()
  .requiredOption("--template <path>", "DSL-marked PPTX 模板路径")
  .option("--input <path>", "DeckInput JSON", "examples/sample-input.json")
  .option("--out <dir>", "输出目录", "outputs");

program.parse();
const options = program.opts<{ template: string; input: string; out: string }>();
const templatePath = path.resolve(options.template);
const inputPath = path.resolve(options.input);
const outDir = path.resolve(options.out);
await mkdir(outDir, { recursive: true });

const manifest = await attachTemplateFingerprint(await analyzeTemplate(await readPptx(templatePath), templatePath), templatePath);
const lint = lintTemplateManifest(manifest);
if (lint.errors.length) throw new Error(`template lint failed:\n${lint.errors.map((error) => `- ${error}`).join("\n")}`);

const input = JSON.parse(await readFile(inputPath, "utf8")) as DeckInput;
await assertValidDeckInput(manifest, input, "raw");

const manifestPath = path.join(outDir, "template-manifest.json");
const schemaPath = path.join(outDir, "input.schema.json");
const lintPath = path.join(outDir, "template-lint.json");
const pptxPath = path.join(outDir, "sample-generated.pptx");
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(schemaPath, `${JSON.stringify(buildInputSchema(manifest), null, 2)}\n`);
await writeFile(lintPath, `${JSON.stringify(lint, null, 2)}\n`);
await generateDeckWithAutomizer({ templatePath, manifest, input, outPath: pptxPath });
console.info(JSON.stringify({ manifestPath, schemaPath, lintPath, pptxPath }, null, 2));
