import { readFile } from "node:fs/promises";
import path from "node:path";
import { Command } from "commander";
import type { DeckInput, TemplateManifest } from "./types.js";
import { validateDeckInput } from "./validation.js";

const program = new Command().requiredOption("--manifest <path>").requiredOption("--input <path>");
program.parse();
const options = program.opts<{ manifest: string; input: string }>();
const manifest = JSON.parse(await readFile(path.resolve(options.manifest), "utf8")) as TemplateManifest;
const input = JSON.parse(await readFile(path.resolve(options.input), "utf8")) as DeckInput;
const errors = await validateDeckInput(manifest, input);
if (errors.length) throw new Error(errors.map((error) => `- ${error}`).join("\n"));
console.info(`[validate-input] passed slides=${input.slides.length}`);
