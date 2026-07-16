import assert from "node:assert/strict";
import test from "node:test";
import { buildInputSchema } from "../src/schema.js";
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
