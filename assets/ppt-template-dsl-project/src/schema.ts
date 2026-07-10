import type { SlideManifest, TemplateManifest } from "./types.js";
import { canPaginateList } from "./validation.js";

export function buildInputSchema(manifest: TemplateManifest): Record<string, unknown> {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "PPT Template DSL Input",
    type: "object",
    additionalProperties: false,
    required: ["slides"],
    properties: {
      title: { type: "string" },
      slides: {
        type: "array",
        minItems: 5,
        items: { anyOf: manifest.slides.map(buildSlideSchema) },
      },
    },
    allOf: [
      requirePageType(manifest, "封面页"),
      requirePageType(manifest, "目录页"),
      requirePageType(manifest, "章节过渡页"),
      requirePageType(manifest, "内容页"),
      requirePageType(manifest, "结尾页"),
    ],
  };
}

function buildSlideSchema(slide: SlideManifest): Record<string, unknown> {
  const fieldProperties: Record<string, unknown> = {};
  for (const field of slide.fields) {
    fieldProperties[field.key] = stringSchemaFromComponent(field.component);
  }

  const listProperties: Record<string, unknown> = {};
  for (const list of slide.lists) {
    const itemProperties: Record<string, unknown> = {};
    for (const itemField of list.itemFields) {
      itemProperties[itemField.key] = stringSchemaFromComponent(itemField.component);
    }
    listProperties[list.key] = {
      type: "array",
      minItems: list.component.length?.min ?? 0,
      ...(list.component.length?.fixed
        ? { maxItems: list.component.length.min }
        : canPaginateList(list)
          ? { "x-page-max-items": list.component.length?.max ?? list.maxItemsInTemplate }
          : { maxItems: Math.min(list.component.length?.max ?? list.maxItemsInTemplate, list.maxItemsInTemplate || 20) }),
      items: {
        type: "object",
        additionalProperties: false,
        required: list.itemFields.filter((field) => field.targets.length > 0).map((field) => field.key),
        properties: itemProperties,
      },
    };
  }

  const requiredSlideProperties = ["templateId"];
  if (slide.fields.some((field) => field.targets.length > 0)) requiredSlideProperties.push("fields");
  if (slide.lists.length > 0) requiredSlideProperties.push("lists");

  return {
    title: `${slide.templateId} ${slide.pageType}`,
    type: "object",
    additionalProperties: false,
    required: requiredSlideProperties,
    properties: {
      templateId: { const: slide.templateId },
      fields: {
        type: "object",
        additionalProperties: false,
        required: slide.fields.filter((field) => field.targets.length > 0).map((field) => field.key),
        properties: fieldProperties,
      },
      lists: {
        type: "object",
        additionalProperties: false,
        required: slide.lists.map((list) => list.key),
        properties: listProperties,
      },
      images: {
        type: "object",
        additionalProperties: false,
        properties: Object.fromEntries(slide.images.map((image) => [image.key, { type: "string", minLength: 1 }])),
      },
      approvedTemplateImages: {
        type: "array",
        uniqueItems: true,
        items: { enum: slide.images.filter((image) => image.role === "content").map((image) => image.key) },
      },
      sourceRefs: {
        type: "array",
        uniqueItems: true,
        items: { type: "string", minLength: 1 },
      },
      continuation: {
        type: "object",
        additionalProperties: false,
        required: ["sourceIndex", "part", "total"],
        properties: {
          sourceIndex: { type: "integer", minimum: 0 },
          part: { type: "integer", minimum: 1 },
          total: { type: "integer", minimum: 1 },
        },
      },
    },
  };
}

function stringSchemaFromComponent(component: { length?: { min: number; max: number }; label?: string }): Record<string, unknown> {
  const schema: Record<string, unknown> = {
    type: ["string", "number"],
    description: component.label ? `替换文本锚点：${component.label}` : undefined,
  };
  if (component.length) {
    schema.minLength = component.length.min;
    schema.maxLength = component.length.max;
  }
  return schema;
}

function requirePageType(manifest: TemplateManifest, pageType: string): Record<string, unknown> {
  const templateIds = manifest.slides.filter((slide) => slide.pageType === pageType).map((slide) => slide.templateId);
  return {
    properties: {
      slides: {
        contains: {
          type: "object",
          properties: { templateId: { enum: templateIds } },
          required: ["templateId"],
        },
      },
    },
  };
}
