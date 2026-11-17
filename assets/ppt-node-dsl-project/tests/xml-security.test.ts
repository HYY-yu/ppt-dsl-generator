import assert from "node:assert/strict";
import test from "node:test";
import { parseRelationships, parsePresentationSlideRelIds } from "../src/pptx/relationships.js";

const relationships = '<Relationships><Relationship Id="rId&#49;" Type="slide" Target="slides/a&amp;b&#x2E;xml" TargetMode="External"/></Relationships>';
const presentation = '<p:presentation><p:sldIdLst><p:sldId r:id="rId&#49;"/></p:sldIdLst></p:presentation>';
const duplicateDoctype = '<!DOCTYPE root><!DOCTYPE root>';

test("shared XML parser rejects duplicate DOCTYPE and recovers across both entry points", () => {
  for (let i = 0; i < 2; i++) {
    assert.deepEqual(parseRelationships('<!DOCTYPE Relationships>' + relationships), [
      { id: "rId&#49;", type: "slide", target: "slides/a&b&#x2E;xml", targetMode: "External" },
    ]);
    assert.deepEqual(parsePresentationSlideRelIds('<!DOCTYPE presentation>' + presentation), ["rId&#49;"]);
    assert.throws(() => parseRelationships(duplicateDoctype + relationships), /DOCTYPE/i);
    assert.throws(() => parsePresentationSlideRelIds(duplicateDoctype + presentation), /DOCTYPE/i);
  }
  assert.deepEqual(parsePresentationSlideRelIds(presentation), ["rId&#49;"]);
  assert.equal(parseRelationships(relationships)[0].target, "slides/a&b&#x2E;xml");
});
