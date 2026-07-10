import type { TemplateManifest } from "./types.js";

export interface TemplateLintResult {
  errors: string[];
  warnings: string[];
}

const REQUIRED_PAGE_TYPES = ["封面页", "目录页", "章节过渡页", "内容页", "结尾页"];

export function lintTemplateManifest(manifest: TemplateManifest): TemplateLintResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const knownPageTypes = new Set(REQUIRED_PAGE_TYPES);

  const invalidSlides = manifest.slides.filter((slide) => !knownPageTypes.has(slide.pageType));
  if (invalidSlides.length) {
    errors.push(`missing or invalid DSL page type: ${invalidSlides.map((slide) => slide.templateId).join(", ")}`);
  }
  const missingPageTypes = REQUIRED_PAGE_TYPES.filter(
    (pageType) => !manifest.slides.some((slide) => slide.pageType === pageType),
  );
  if (missingPageTypes.length) errors.push(`missing required page types: ${missingPageTypes.join(", ")}`);

  for (const slide of manifest.slides) {
    for (const warning of slide.warnings) warnings.push(`${slide.templateId}: ${warning}`);
    for (const field of slide.fields) {
      if (!field.targets.length) warnings.push(`${slide.templateId}: field ${field.key} has no text target`);
    }
    for (const list of slide.lists) {
      const min = list.component.length?.min ?? 0;
      if (list.maxItemsInTemplate < min) {
        errors.push(`${slide.templateId}: list ${list.key} has ${list.maxItemsInTemplate} targets but DSL requires at least ${min}`);
      }
      for (const itemField of list.itemFields) {
        if (!itemField.targets.length) warnings.push(`${slide.templateId}: list ${list.key} field ${itemField.key} has no text target`);
      }
    }
  }
  return { errors, warnings };
}
