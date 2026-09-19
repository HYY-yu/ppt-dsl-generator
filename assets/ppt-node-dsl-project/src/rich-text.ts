import type { ComponentManifest, RichTextValue, TextValue } from "./types.js";

export const RICH_TEXT_MIN_MAX_LENGTH = 40;
export const RICH_TEXT_MAX_PARAGRAPHS = 8;
export const RICH_TEXT_MAX_RUNS_PER_PARAGRAPH = 12;

export function componentSupportsRichText(component: Pick<ComponentManifest, "kind" | "length">): boolean {
  return component.kind === "text" && (component.length?.max ?? 0) >= RICH_TEXT_MIN_MAX_LENGTH;
}

export function isRichTextValue(value: unknown): value is RichTextValue {
  return typeof value === "object" && value !== null && Array.isArray((value as RichTextValue).paragraphs);
}

export function plainTextFromValue(value: TextValue): string {
  if (typeof value === "string") return value;
  return value.paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join("")).join("\n");
}
