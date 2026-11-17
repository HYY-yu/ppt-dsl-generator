import { access } from "node:fs/promises";
import path from "node:path";
import type { DeckInput, TemplateManifest } from "./types.js";
import { validateDeckInputWithAssets, validateDeckContent as validateContent } from "./validation-core.js";
export { meaningfulTextLength } from "./validation-core.js";

/** Filesystem adapter; shared content rules remain browser-safe. */
export async function validateDeckInput(manifest: TemplateManifest, input: DeckInput): Promise<string[]> {
  return validateDeckInputWithAssets(manifest, input, { resolve: source => path.resolve(source), extname: path.extname, access });
}

export async function assertValidDeckInput(manifest: TemplateManifest, input: DeckInput): Promise<void> {
  const errors = await validateDeckInput(manifest, input);
  if (errors.length) throw new Error(`DeckInput 校验失败:\n${errors.map((error) => `- ${error}`).join("\n")}`);
}

export async function validateDeckContent(manifest: TemplateManifest, input: DeckInput): Promise<string[]> {
  return validateContent(manifest, input, { resolve: source => path.resolve(source), extname: path.extname, access });
}
