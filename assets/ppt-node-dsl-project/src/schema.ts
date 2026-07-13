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

function slideSchema(slide: SlideManifest): Record<string, unknown> {
  return {
    type: "object",
    required: ["templateId", ...(slide.nodes.length ? ["nodes"] : []), ...(slide.lists.length ? ["lists"] : [])],
    additionalProperties: false,
    properties: {
      templateId: { const: slide.templateId },
      nodes: componentObject(slide.nodes),
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

function listSchema(list: ListManifest): Record<string, unknown> {
  return {
    type: "array",
    minItems: list.minItems,
    maxItems: list.maxItems,
    items: componentObject(list.items[0]?.components ?? [], true),
  };
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
  if (component.kind === "image" || component.kind === "icon") {
    return { anyOf: [{ type: "string", minLength: 1 }, { type: "object", required: ["path"], additionalProperties: false, properties: { path: { type: "string", minLength: 1 } } }] };
  }
  if (component.kind === "number") return { anyOf: [{ type: "integer", minimum: 0 }, { type: "string", minLength: 1 }] };
  return { type: "string", minLength: component.length?.min ?? 1, maxLength: component.length?.max };
}
