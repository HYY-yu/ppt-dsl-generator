import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { TemplateManifest } from "./types.js";

export const TEMPLATE_MANIFEST_VERSION = 2;

export function assertRuntimeManifestComplete(manifest: TemplateManifest): void {
  if (!manifest || !Array.isArray(manifest.slides) || manifest.slides.length === 0) {
    throw new Error("runtime manifest 缺少 slides");
  }
  for (const [slideIndex, slide] of manifest.slides.entries()) {
    const label = slide?.templateId || `slides[${slideIndex}]`;
    if (!Number.isInteger(slide?.slideNumber) || slide.slideNumber <= 0) {
      throw new Error(`${label} 缺少有效 slideNumber；禁止向 Runtime 传递精简 manifest`);
    }
    if (!slide.slidePath?.trim()) {
      throw new Error(`${label} 缺少 slidePath；禁止向 Runtime 传递精简 manifest`);
    }
    if (!Array.isArray(slide.nodes) || !Array.isArray(slide.lists)) {
      throw new Error(`${label} 的 nodes/lists 合同无效`);
    }
    for (const component of slide.nodes) assertComponentLocator(label, component.key, component.locator);
    for (const list of slide.lists) {
      if (!Array.isArray(list.items) || list.items.length === 0) {
        throw new Error(`${label}.${list.key} 缺少编译后的 list.items`);
      }
      for (const item of list.items) {
        if (!Array.isArray(item.components)) throw new Error(`${label}.${list.key} 的 components 合同无效`);
        for (const component of item.components) assertComponentLocator(label, `${list.key}.${component.key}`, component.locator);
      }
    }
  }
}

function assertComponentLocator(slide: string, component: string, locator: { shapeId?: string; path?: number[] } | undefined): void {
  if (!locator?.shapeId || !Array.isArray(locator.path)) {
    throw new Error(`${slide}.${component} 缺少编译后的 locator`);
  }
}

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
  assertRuntimeManifestComplete(manifest);
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
