import { readFile } from "node:fs/promises";
import path from "node:path";
import { Command } from "commander";
import type { DeckInput, TemplateManifest } from "./types.js";
import { generateDeckWithAutomizer } from "./pptx/automizer-generate.js";
import { assertManifestMatchesTemplate } from "./template-contract.js";

const program = new Command()
  .requiredOption("--template <path>", "PPTX 模板路径")
  .requiredOption("--manifest <path>", "analyze 生成的 template-manifest.json")
  .requiredOption("--input <path>", "deck input JSON")
  .requiredOption("--out <path>", "输出 PPTX 路径");

program.parse();
const options = program.opts<{ template: string; manifest: string; input: string; out: string }>();

const templatePath = path.resolve(options.template);
const manifestPath = path.resolve(options.manifest);
const inputPath = path.resolve(options.input);
const outPath = path.resolve(options.out);

console.info(`[generate] 读取模板: ${templatePath}`);
const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as TemplateManifest;
const input = JSON.parse(await readFile(inputPath, "utf8")) as DeckInput;
await assertManifestMatchesTemplate(manifest, templatePath);
await generateDeckWithAutomizer({ templatePath, manifest, input, outPath });
console.info(`[generate] 输出: ${outPath}`);
