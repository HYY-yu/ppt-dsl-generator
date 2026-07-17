import { readFile } from "node:fs/promises";
import path from "node:path";
import { Command } from "commander";
import type { DeckInput, TemplateManifest } from "./types.js";
import { validateDeckContent, validateDeckInput } from "./validation.js";
import { bindDeterministicNumbers } from "./deck-numbers.js";
import { assertRuntimeManifestComplete } from "./template-contract.js";

const program = new Command().requiredOption("--manifest <path>").requiredOption("--input <path>").option("--content-only", "只校验 LLM 文本草稿，禁止出现尚未绑定的非文本字段");
program.parse();
const options = program.opts<{ manifest: string; input: string; contentOnly?: boolean }>();
const manifest = JSON.parse(await readFile(path.resolve(options.manifest), "utf8")) as TemplateManifest;
const input = JSON.parse(await readFile(path.resolve(options.input), "utf8")) as DeckInput;
assertRuntimeManifestComplete(manifest);
const errors = options.contentOnly
  ? await validateDeckContent(manifest, input)
  : await validateDeckInput(manifest, bindDeterministicNumbers(manifest, input));
if (errors.length) throw new Error(errors.map((error) => `- ${error}`).join("\n"));
console.info(`[validate-input] passed mode=${options.contentOnly ? "content" : "final"} slides=${input.slides.length}`);
