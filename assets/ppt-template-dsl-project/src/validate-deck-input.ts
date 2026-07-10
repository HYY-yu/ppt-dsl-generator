import { readFile } from "node:fs/promises";
import path from "node:path";
import { Command } from "commander";
import type { DeckInput, TemplateManifest } from "./types.js";
import { validateDeckInput, type ValidationMode } from "./validation.js";

const program = new Command()
  .requiredOption("--manifest <path>", "analyze 生成的 template-manifest.json")
  .requiredOption("--input <path>", "deck input JSON")
  .option("--mode <mode>", "raw 或 expanded", "raw");

program.parse();
const options = program.opts<{ manifest: string; input: string; mode: ValidationMode }>();
if (options.mode !== "raw" && options.mode !== "expanded") {
  throw new Error(`未知 validation mode: ${options.mode}`);
}

const manifest = JSON.parse(await readFile(path.resolve(options.manifest), "utf8")) as TemplateManifest;
const input = JSON.parse(await readFile(path.resolve(options.input), "utf8")) as DeckInput;
const result = await validateDeckInput(manifest, input, options.mode);

console.log(JSON.stringify(result, null, 2));
if (result.errors.length > 0) process.exitCode = 1;
