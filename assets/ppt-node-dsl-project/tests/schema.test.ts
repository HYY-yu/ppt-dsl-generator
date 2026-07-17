import assert from "node:assert/strict";
import test from "node:test";
import { buildDeckContentSchema, buildInputSchema } from "../src/schema.js";
import type { TemplateManifest } from "../src/types.js";

test("preserves short dynamic-list text ranges from the template contract", () => {
  const manifest = {
    slides: [{
      templateId: "directory",
      nodes: [],
      lists: [{
        key: "list_1",
        minItems: 1,
        maxItems: 4,
        items: [{
          components: [{ key: "text_1", kind: "text", length: { min: 2, max: 4 } }],
        }],
      }],
    }],
  } as unknown as TemplateManifest;

  const schema = buildInputSchema(manifest) as any;
  const textSchema = schema.properties.slides.items.anyOf[0]
    .properties.lists.properties.list_1.items.properties.text_1;

  assert.deepEqual(textSchema, { type: "string", minLength: 2, maxLength: 4 });
});

test("exposes node and list sampleContent to structured-output consumers", () => {
  const manifest = {
    slides: [{
      templateId: "content",
      nodes: [{ key: "text_1", kind: "text", sampleContent: "核心结论", length: { min: 2, max: 8 } }],
      lists: [{
        key: "list_1",
        minItems: 1,
        maxItems: 3,
        componentContract: [{ key: "text_1", kind: "text", length: { min: 2, max: 8 } }],
        items: [{ components: [{ key: "text_1", kind: "text", sampleContent: "市场机会", length: { min: 2, max: 8 } }] }],
      }],
    }],
  } as unknown as TemplateManifest;

  const schema = buildInputSchema(manifest) as any;
  const slide = schema.properties.slides.items.anyOf[0];
  assert.match(slide.properties.nodes.properties.text_1.description, /核心结论/);
  assert.match(slide.properties.lists.properties.list_1.items.properties.text_1.description, /市场机会/);
  assert.match(slide.properties.nodes.properties.text_1.description, /不得照抄/);
});

test("keeps page and list number fields optional for deterministic binding", () => {
  const manifest = {
    slides: [{
      templateId: "transition",
      nodes: [
        { key: "text_1", kind: "text", length: { min: 2, max: 8 } },
        { key: "number_1", kind: "number", numberWidth: 3 },
      ],
      lists: [],
    }],
  } as unknown as TemplateManifest;

  const schema = buildInputSchema(manifest) as any;
  const required = schema.properties.slides.items.anyOf[0].properties.nodes.required;
  assert.deepEqual(required, ["text_1"]);
});

test("builds a text-only draft schema while preserving list capacity", () => {
  const manifest = {
    slides: [{
      templateId: "content",
      nodes: [
        { key: "text_1", kind: "text", sampleContent: "结论", length: { min: 2, max: 8 } },
        { key: "number_1", kind: "number", numberWidth: 2 },
        { key: "image_1", kind: "image" },
      ],
      lists: [{
        key: "list_1",
        minItems: 2,
        maxItems: 4,
        componentContract: [
          { key: "text_1", kind: "text", sampleContent: "要点", length: { min: 2, max: 8 } },
          { key: "icon_1", kind: "icon" },
          { key: "number_1", kind: "number", numberWidth: 2 },
        ],
        items: [{ components: [] }],
      }],
    }],
  } as unknown as TemplateManifest;

  const schema = buildDeckContentSchema(manifest) as any;
  const slide = schema.properties.slides.items.anyOf[0];
  assert.deepEqual(Object.keys(slide.properties.nodes.properties), ["text_1"]);
  assert.deepEqual(Object.keys(slide.properties.lists.properties.list_1.items.properties), ["text_1"]);
  assert.equal(slide.properties.lists.properties.list_1.minItems, 2);
  assert.equal(slide.properties.lists.properties.list_1.maxItems, 4);
});
