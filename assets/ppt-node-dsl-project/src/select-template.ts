import { readFile } from "node:fs/promises";
import { Command } from "commander";
import { selectCandidates } from "./select.js";
const program = new Command().requiredOption("--manifest <path>").requiredOption("--request <path>");
program.parse();
const options = program.opts();
const candidates = selectCandidates(JSON.parse(await readFile(options.manifest, "utf8")), JSON.parse(await readFile(options.request, "utf8")));
console.info(JSON.stringify(candidates, null, 2));
if (!candidates.length) process.exitCode = 1;
