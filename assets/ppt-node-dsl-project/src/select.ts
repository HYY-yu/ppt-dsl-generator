import type { ComponentKind, PageType, TemplateManifest } from "./types.js";
import { assertRuntimeManifestComplete } from "./manifest-contract.js";

export interface CandidateRequest {
  pageType: PageType;
  listCounts?: Record<string, number>;
  availableAssetKinds: ComponentKind[];
  logic?: string[];
  usedTemplateIds?: string[];
}
/** Hard capacity/asset filters, then ordered logic and reuse ranking. No semantic claims. */
export function selectCandidates(manifest: TemplateManifest, request: CandidateRequest) {
  assertRuntimeManifestComplete(manifest);
  const candidates = manifest.slides.filter(slide => {
    if (slide.pageType !== request.pageType) return false;
    for (const [key, count] of Object.entries(request.listCounts ?? {})) {
      const list = slide.lists.find(list => list.key === key);
      if (!Number.isInteger(count) || !list || count < list.minItems || count > list.maxItems) return false;
    }
    const nodes = [...slide.nodes, ...slide.lists.flatMap(list => list.componentContract)];
    return nodes.every(node => !["image", "background", "icon"].includes(node.kind) || request.availableAssetKinds.includes(node.kind));
  });
  const score = (slide: typeof candidates[number]) => [
    (request.logic ?? []).reduce((n, logic, i) => n + (slide.logic[i] === logic ? 0 : 1), 0),
    slide.lists.reduce((n, list) => n + (request.listCounts?.[list.key] === undefined ? 0 : list.maxItems - request.listCounts[list.key]), 0),
    (request.usedTemplateIds ?? []).filter(id => id === slide.templateId).length,
  ];
  return candidates.sort((a, b) => {
    const sa = score(a), sb = score(b);
    for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return sa[i] - sb[i];
    return a.templateId < b.templateId ? -1 : a.templateId > b.templateId ? 1 : 0;
  });
}
