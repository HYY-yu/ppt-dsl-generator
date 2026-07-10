import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { assertManifestMatchesTemplate, attachTemplateFingerprint } from "../src/template-contract.js";
import type { TemplateManifest } from "../src/types.js";

test("rejects a manifest when its template fingerprint is stale", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ppt-dsl-contract-"));
  const templatePath = path.join(directory, "template.pptx");
  try {
    await writeFile(templatePath, "first template revision");
    const manifest: TemplateManifest = {
      sourceTemplate: templatePath,
      generatedAt: "2026-07-10T00:00:00.000Z",
      slideCount: 0,
      slides: [],
    };
    const fingerprinted = await attachTemplateFingerprint(manifest, templatePath);
    await assertManifestMatchesTemplate(fingerprinted, templatePath);

    await writeFile(templatePath, "second template revision");
    await assert.rejects(assertManifestMatchesTemplate(fingerprinted, templatePath), /fingerprint mismatch/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
