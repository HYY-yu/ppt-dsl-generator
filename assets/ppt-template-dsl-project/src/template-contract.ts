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
      `manifest version ${manifest.manifestVersion ?? "(missing)"} is unsupported; rerun analyze for this template`,
    );
  }
  if (!manifest.templateSha256) {
    throw new Error("manifest is missing templateSha256; rerun analyze for this template");
  }
  const actual = await sha256File(templatePath);
  if (actual !== manifest.templateSha256) {
    throw new Error(
      `manifest/template fingerprint mismatch for ${path.basename(templatePath)}; rerun analyze after changing the template`,
    );
  }
}

async function sha256File(filePath: string): Promise<string> {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}
