import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { TemplateManifest } from "./types.js";

export const TEMPLATE_MANIFEST_VERSION = 2;

export async function attachTemplateFingerprint(
  manifest: TemplateManifest,
  templatePath: string,
): Promise<TemplateManifest> {
  return {
    ...manifest,
    manifestVersion: TEMPLATE_MANIFEST_VERSION,
    templateSha256: await sha256File(templatePath),
  };
}

export async function assertManifestMatchesTemplate(
  manifest: TemplateManifest,
  templatePath: string,
): Promise<void> {
  if (manifest.manifestVersion !== TEMPLATE_MANIFEST_VERSION) {
    throw new Error(
      `manifestVersion ${manifest.manifestVersion ?? "(缺失)"} 不受支持；请重新运行 compile-template`,
    );
  }
  if (!manifest.templateSha256) {
    throw new Error("manifest 缺少 templateSha256；请重新运行 compile-template");
  }
  const actual = await sha256File(templatePath);
  if (actual !== manifest.templateSha256) {
    throw new Error(
      `${path.basename(templatePath)} 与 manifest 的 SHA-256 指纹不一致；模板修改后请重新运行 compile-template`,
    );
  }
}

async function sha256File(filePath: string): Promise<string> {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}
