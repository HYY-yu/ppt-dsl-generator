import { access } from "node:fs/promises";
import path from "node:path";
import type { DeckInput, DeckInputSlide, DslComponent, FieldManifest, SlideManifest, TemplateManifest } from "./types.js";

export type ValidationMode = "raw" | "expanded";

export interface ValidationResult {
  slides: number;
  errors: string[];
  warnings: string[];
}

export async function validateDeckInput(
  manifest: TemplateManifest,
  input: DeckInput,
  mode: ValidationMode = "raw",
): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const byTemplateId = new Map(manifest.slides.map((slide) => [slide.templateId, slide]));
  const usedPageTypes = new Set<string>();
  const templateUse = new Map<string, number>();

  for (const key of Object.keys(input)) {
    if (!new Set(["title", "slides"]).has(key)) errors.push(`unknown top-level property ${key}`);
  }
  if (input.title !== undefined && typeof input.title !== "string") errors.push("input.title must be a string");

  if (!Array.isArray(input.slides) || input.slides.length === 0) {
    errors.push("input.slides must be a non-empty array");
  } else {
    for (const [index, slideInput] of input.slides.entries()) {
      const label = `slide ${index + 1}`;
      for (const key of Object.keys(slideInput)) {
        if (!new Set(["templateId", "fields", "lists", "images", "approvedTemplateImages", "sourceRefs", "continuation"]).has(key)) {
          errors.push(`${label}: unknown property ${key}`);
        }
      }
      const slide = byTemplateId.get(slideInput.templateId);
      if (!slide) {
        errors.push(`${label}: unknown templateId ${slideInput.templateId || "(missing)"}`);
        continue;
      }

      usedPageTypes.add(slide.pageType);
      templateUse.set(slide.templateId, (templateUse.get(slide.templateId) ?? 0) + 1);
      validateAdjacentTemplate(input.slides, index, mode, errors);
      validateRequiredBindings(label, slide, slideInput, errors);
      validateFields(label, slide, slideInput.fields ?? {}, errors);
      validateLists(label, slide, slideInput.fields ?? {}, slideInput.lists ?? {}, mode, errors, warnings);
      await validateImages(label, slide, slideInput, errors);
      validateSourceRefs(label, slideInput, errors);
    }
  }

  for (const pageType of ["封面页", "目录页", "章节过渡页", "内容页", "结尾页"]) {
    if (!usedPageTypes.has(pageType)) errors.push(`missing required page type ${pageType}`);
  }

  for (const [templateId, count] of templateUse) {
    const slide = byTemplateId.get(templateId);
    if (slide?.pageType === "内容页" && count > 2) {
      warnings.push(`template ${templateId}: reused ${count} times; review deck-wide template diversity`);
    }
  }

  return { slides: input.slides?.length ?? 0, errors, warnings };
}

export async function assertValidDeckInput(
  manifest: TemplateManifest,
  input: DeckInput,
  mode: ValidationMode = "raw",
): Promise<void> {
  const result = await validateDeckInput(manifest, input, mode);
  if (result.errors.length) {
    throw new Error(`DeckInput validation failed (${mode}):\n${result.errors.map((error) => `- ${error}`).join("\n")}`);
  }
}

function validateAdjacentTemplate(
  slides: DeckInputSlide[],
  index: number,
  mode: ValidationMode,
  errors: string[],
): void {
  if (index === 0 || slides[index - 1]?.templateId !== slides[index]?.templateId) return;
  const current = slides[index]?.continuation;
  const previous = slides[index - 1]?.continuation;
  const isPaginationContinuation = mode === "expanded"
    && current
    && previous
    && current.sourceIndex === previous.sourceIndex
    && current.part === previous.part + 1
    && current.total === previous.total;
  if (!isPaginationContinuation) errors.push(`slide ${index + 1}: adjacent duplicate template ${slides[index]?.templateId}`);
}

function validateRequiredBindings(
  label: string,
  slide: SlideManifest,
  input: DeckInputSlide,
  errors: string[],
): void {
  for (const field of slide.fields.filter((candidate) => candidate.targets.length > 0)) {
    if (input.fields?.[field.key] === undefined) errors.push(`${label}: missing required field ${field.key}`);
  }
  for (const list of slide.lists) {
    const items = input.lists?.[list.key];
    if (!items) {
      errors.push(`${label}: missing required list ${list.key}`);
      continue;
    }
    for (const [itemIndex, item] of items.entries()) {
      for (const field of list.itemFields.filter((candidate) => candidate.targets.length > 0)) {
        if (item[field.key] === undefined) {
          errors.push(`${label} ${list.key} item ${itemIndex + 1}: missing required item field ${field.key}`);
        }
      }
    }
  }
}

function validateFields(
  label: string,
  slide: SlideManifest,
  fields: Record<string, string | number>,
  errors: string[],
): void {
  const fieldByKey = new Map(slide.fields.map((field) => [field.key, field]));
  for (const [key, value] of Object.entries(fields)) {
    const field = fieldByKey.get(key);
    if (!field) {
      errors.push(`${label}: unknown field ${key}`);
      continue;
    }
    validateText(`${label} field ${key}`, value, field, errors);
  }
}

function validateLists(
  label: string,
  slide: SlideManifest,
  fields: Record<string, string | number>,
  lists: Record<string, Array<Record<string, string | number>>>,
  mode: ValidationMode,
  errors: string[],
  warnings: string[],
): void {
  const listByKey = new Map(slide.lists.map((list) => [list.key, list]));
  let hasRawOverflow = false;
  for (const [key, items] of Object.entries(lists)) {
    const list = listByKey.get(key);
    if (!list) {
      errors.push(`${label}: unknown list ${key}`);
      continue;
    }
    if (!Array.isArray(items)) {
      errors.push(`${label} ${key}: must be an array`);
      continue;
    }
    const length = list.component.length;
    if (length?.fixed && items.length !== length.min) {
      errors.push(`${label} ${key}: fixed length ${length.min}, got ${items.length}`);
    } else if (length && items.length < length.min) {
      errors.push(`${label} ${key}: below DSL min ${length.min}, got ${items.length}`);
    } else if (length && items.length > length.max) {
      if (mode === "raw" && canPaginateList(list)) {
        hasRawOverflow = true;
        warnings.push(`${label} ${key}: ${items.length} items will be paginated with page capacity ${length.max}`);
      } else {
        errors.push(`${label} ${key}: above DSL max ${length.max}, got ${items.length}`);
      }
    }

    const itemFieldByKey = new Map(list.itemFields.map((field) => [field.key, field]));
    for (const [itemIndex, item] of items.entries()) {
      for (const [itemKey, value] of Object.entries(item)) {
        const field = itemFieldByKey.get(itemKey);
        if (!field) {
          errors.push(`${label} ${key} item ${itemIndex + 1}: unknown item field ${itemKey}`);
          continue;
        }
        validateText(`${label} ${key} item ${itemIndex + 1} ${itemKey}`, value, field, errors);
      }
    }
  }

  if (mode === "raw" && hasRawOverflow) return;
  const counts = Object.values(lists).map((items) => items.length);
  if (!counts.length) return;
  for (const [key, value] of Object.entries(fields)) {
    if (!/标题|title/i.test(key)) continue;
    const expected = countNamedInTitle(String(value));
    if (expected !== undefined && !counts.includes(expected)) {
      errors.push(`${label} field ${key}: title says ${expected} items but lists contain ${counts.join(", ")} items`);
    }
  }
}

async function validateImages(
  label: string,
  slide: SlideManifest,
  input: DeckInputSlide,
  errors: string[],
): Promise<void> {
  const images = input.images ?? {};
  const approved = new Set(input.approvedTemplateImages ?? []);
  const knownKeys = new Set(slide.images.map((image) => image.key));
  const contentImageKeys = new Set(slide.images.filter((image) => image.role === "content").map((image) => image.key));

  for (const key of approved) {
    if (!knownKeys.has(key)) errors.push(`${label}: approved template image key ${key} does not exist`);
    if (knownKeys.has(key) && !contentImageKeys.has(key)) errors.push(`${label}: only content images may use approvedTemplateImages (${key})`);
    if (images[key]) errors.push(`${label}: image ${key} cannot be both replaced and approved`);
  }

  for (const [key, sourcePath] of Object.entries(images)) {
    if (!knownKeys.has(key)) {
      errors.push(`${label}: image key ${key} does not resolve to a template image target`);
      continue;
    }
    if (!sourcePath.trim()) {
      errors.push(`${label}: image ${key} has an empty source path`);
      continue;
    }
    try {
      await access(path.resolve(sourcePath));
    } catch {
      errors.push(`${label}: image ${key} source does not exist: ${sourcePath}`);
    }
  }

  for (const key of contentImageKeys) {
    if (!images[key] && !approved.has(key)) {
      errors.push(`${label}: template image ${key} must be replaced or explicitly listed in approvedTemplateImages`);
    }
  }
}

function validateSourceRefs(label: string, input: DeckInputSlide, errors: string[]): void {
  if (input.sourceRefs === undefined) return;
  if (!Array.isArray(input.sourceRefs)) {
    errors.push(`${label}: sourceRefs must be an array`);
    return;
  }
  for (const [index, value] of input.sourceRefs.entries()) {
    if (typeof value !== "string" || !value.trim()) errors.push(`${label}: sourceRefs[${index}] must be a non-empty string`);
  }
}

function validateText(label: string, rawValue: string | number, field: FieldManifest, errors: string[]): void {
  const value = String(rawValue ?? "").trim();
  const charCount = [...value].length;
  if (charCount === 0) {
    errors.push(`${label}: empty value`);
    return;
  }

  const length = field.component.length;
  if (length && charCount < length.min) errors.push(`${label}: below DSL min ${length.min}, got ${charCount}`);
  if (length && charCount > length.max) errors.push(`${label}: above DSL max ${length.max}, got ${charCount}`);

  const minimum = densityMinimum(field.component, field.key);
  if (minimum > 0 && charCount < minimum) {
    errors.push(`${label}: descriptive copy is too thin; need at least ${minimum} characters, got ${charCount}`);
  }
}

function densityMinimum(component: DslComponent, key: string): number {
  if (/^[XY]轴说明$|图例|标签|单位/.test(key)) return 0;
  const isCore = /核心表述|关键观点|核心观点|核心结论/.test(key);
  const isDescription = /内容|描述|说明|概述|摘要|洞察|结论|价值/.test(key);
  if (!isCore && !isDescription) return 0;

  const baseline = isCore ? 7 : 14;
  const length = component.length;
  if (!length) return baseline;
  return Math.max(length.min, Math.min(baseline, Math.ceil(length.max * 0.6)));
}

export function canPaginateList(list: SlideManifest["lists"][number]): boolean {
  const length = list.component.length;
  if (!length || length.fixed || length.max <= 0 || !list.itemFields.length || list.maxItemsInTemplate <= 0) return false;
  return list.itemFields.every((field) => field.targets.length >= list.maxItemsInTemplate);
}

export function countNamedInTitle(value: string): number | undefined {
  const digit = value.match(/(\d+)\s*(?:个|项|步|阶段|模块|要点|策略|动作)/)?.[1];
  if (digit) return Number(digit);
  const han = value.match(/(十[一二三四五六七八九]?|[一二三四五六七八九])\s*(?:个|项|步|阶段|模块|要点|策略|动作)/)?.[1];
  if (!han) return undefined;
  if (han === "十") return 10;
  if (han.startsWith("十")) return 10 + (new Map([
    ["一", 1], ["二", 2], ["三", 3], ["四", 4], ["五", 5],
    ["六", 6], ["七", 7], ["八", 8], ["九", 9],
  ]).get(han.slice(1)) ?? 0);
  return new Map([
    ["一", 1], ["二", 2], ["三", 3], ["四", 4], ["五", 5],
    ["六", 6], ["七", 7], ["八", 8], ["九", 9],
  ]).get(han);
}
