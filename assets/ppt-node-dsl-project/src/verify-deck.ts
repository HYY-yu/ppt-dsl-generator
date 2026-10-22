import path from "node:path";
import { Command } from "commander";
import { readPptx } from "./pptx/read.js";
import { verifyDeckPackage } from "./pptx/verify.js";

const program = new Command().requiredOption("--pptx <path>");
program.parse();
const options = program.opts<{ pptx: string }>();
const report = await verifyDeckPackage(await readPptx(path.resolve(options.pptx)));
console.info(JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
