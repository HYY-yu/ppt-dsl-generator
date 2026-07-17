import type { ComponentManifest, ListManifest, SlideManifest, TemplateManifest } from "./types.js";

export function buildInputSchema(manifest: TemplateManifest): Record<string, unknown> {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    required: ["slides"],
    additionalProperties: false,
    properties: {
      title: { type: "string" },
      slides: { type: "array", minItems: 1, items: { anyOf: manifest.slides.map(slideSchema) } },
    },
  };
}

export function buildDeckContentSchema(manifest: TemplateManifest): Record<string, unknown> {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    required: ["slides"],
    additionalProperties: false,
    properties: {
      title: { type: "string" },
      slides: { type: "array", minItems: 1, items: { anyOf: manifest.slides.map(contentSlideSchema) } },
    },
  };
}

function slideSchema(slide: SlideManifest): Record<string, unknown> {
  const requiredNodes = slide.nodes.some((component) => component.kind !== "number");
  return {
    type: "object",
    required: ["templateId", ...(requiredNodes ? ["nodes"] : []), ...(slide.lists.length ? ["lists"] : [])],
    additionalProperties: false,
    properties: {
      templateId: { const: slide.templateId },
      nodes: componentObject(slide.nodes, true),
      lists: {
        type: "object",
        additionalProperties: false,
        required: slide.lists.map((list) => list.key),
        properties: Object.fromEntries(slide.lists.map((list) => [list.key, listSchema(list)])),
      },
      sourceRefs: { type: "array", items: { type: "string" } },
    },
  };
}

function contentSlideSchema(slide: SlideManifest): Record<string, unknown> {
  const textNodes = slide.nodes.filter((component) => component.kind === "text");
  return {
    type: "object",
    required: ["templateId", ...(textNodes.length ? ["nodes"] : []), ...(slide.lists.length ? ["lists"] : [])],
    additionalProperties: false,
    properties: {
      templateId: { const: slide.templateId },
      nodes: componentObject(textNodes),
      lists: {
        type: "object",
        additionalProperties: false,
        required: slide.lists.map((list) => list.key),
        properties: Object.fromEntries(slide.lists.map((list) => [list.key, contentListSchema(list)])),
      },
      sourceRefs: { type: "array", items: { type: "string" } },
    },
  };
}

function listSchema(list: ListManifest): Record<string, unknown> {
  return {
    type: "array",
    minItems: list.minItems,
    maxItems: list.maxItems,
    items: componentObject(listSchemaComponents(list), true),
  };
}

function contentListSchema(list: ListManifest): Record<string, unknown> {
  return {
    type: "array",
    minItems: list.minItems,
    maxItems: list.maxItems,
    items: componentObject(listSchemaComponents(list).filter((component) => component.kind === "text")),
  };
}

function listSchemaComponents(list: ListManifest): ComponentManifest[] {
  const first = list.items[0]?.components ?? [];
  if (!list.componentContract?.length) return first;
  return list.componentContract.map((contract) => {
    const sample = first.find((component) => component.key === contract.key);
    return {
      ...sample,
      ...contract,
      sampleContent: contract.sampleContent || sample?.sampleContent || "",
    } as ComponentManifest;
  });
}

function componentObject(components: ComponentManifest[], numberOptional = false): Record<string, unknown> {
  const required = components.filter((component) => !(numberOptional && component.kind === "number")).map((component) => component.key);
  return {
    type: "object",
    additionalProperties: false,
    required,
    properties: Object.fromEntries(components.map((component) => [component.key, valueSchema(component)])),
  };
}

function valueSchema(component: ComponentManifest): Record<string, unknown> {
  const sample = component.sampleContent?.replace(/\s+/gu, " ").trim();
  const semanticHint = sample
    ? { description: `模板示例内容：${sample}。仅用于提示该字段承载的内容类型，不得照抄，也不替代长度约束。` }
    : {};
  if (component.kind === "image" || component.kind === "icon") {
    return { ...semanticHint, anyOf: [{ type: "string", minLength: 1 }, { type: "object", required: ["path"], additionalProperties: false, properties: { path: { type: "string", minLength: 1 } } }] };
  }
  if (component.kind === "number") return { ...semanticHint, anyOf: [{ type: "integer", minimum: 0 }, { type: "string", minLength: 1 }] };
  return { ...semanticHint, type: "string", minLength: component.length?.min ?? 1, maxLength: component.length?.max };
}
