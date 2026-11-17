import { copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { analyzeTemplate, type AnalyzeTemplateOptions } from "./pptx/analyze.js";
import { readPptx } from "./pptx/read.js";
import { buildDeckContentSchema, buildInputSchema } from "./schema.js";
import { attachTemplateFingerprint } from "./template-contract.js";
import { lintTemplate } from "./lint.js";

export async function compileTemplate(templatePath: string, outDir: string, options?: AnalyzeTemplateOptions) {
  await mkdir(outDir, { recursive: true });
  console.info(`[compile] template=${templatePath}`);
  const manifest = await attachTemplateFingerprint(
    await analyzeTemplate(await readPptx(templatePath), templatePath, options),
    templatePath,
  );
  const lint = lintTemplate(manifest);
  await writeFile(path.join(outDir, "template-lint.json"), `${JSON.stringify(lint, null, 2)}\n`);
  if (lint.errors.length) throw new Error(`模板节点 DSL 检查失败:\n${lint.errors.map(error => `- ${error}`).join("\n")}`);
  await writeFile(path.join(outDir, "template-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(path.join(outDir, "input.schema.json"), `${JSON.stringify(buildInputSchema(manifest), null, 2)}\n`);
  await writeFile(path.join(outDir, "deck-content.schema.json"), `${JSON.stringify(buildDeckContentSchema(manifest), null, 2)}\n`);
  await writeFile(path.join(outDir, "template.lock.json"), `${JSON.stringify({ manifestVersion: manifest.manifestVersion, templateSha256: manifest.templateSha256 }, null, 2)}\n`);
  await copyFile(templatePath, path.join(outDir, "template.pptx"));

  const nodeCount = manifest.slides.reduce((sum, slide) => sum + slide.nodes.length +
    slide.lists.flatMap(list => list.items.flatMap(item => item.components)).length, 0);
  console.info(`[compile] slides=${manifest.slideCount} nodes=${nodeCount} errors=${lint.errors.length} warnings=${lint.warnings.length}`);
  return manifest;
}
