import { readFile } from "node:fs/promises";
import path from "node:path";
import { Command } from "commander";
import { generateDeck } from "./pptx/generate.js";
import type { DeckInput, TemplateManifest } from "./types.js";

const program = new Command().requiredOption("--template <path>").requiredOption("--manifest <path>").requiredOption("--input <path>").requiredOption("--out <path>");
program.parse();
const options = program.opts<{ template: string; manifest: string; input: string; out: string }>();
const manifest = JSON.parse(await readFile(path.resolve(options.manifest), "utf8")) as TemplateManifest;
const input = JSON.parse(await readFile(path.resolve(options.input), "utf8")) as DeckInput;
await generateDeck({ templatePath: path.resolve(options.template), manifest, input, outPath: path.resolve(options.out) });
