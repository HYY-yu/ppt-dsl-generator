import type { DeckInput, NodeValue, TemplateManifest } from "./types.js";

export function bindDeterministicNumbers(manifest: TemplateManifest, input: DeckInput): DeckInput {
  const bound = cloneDeckInput(input);
  let chapterNumber = 0;
  for (const slide of bound.slides) {
    const template = manifest.slides.find((candidate) => candidate.templateId === slide.templateId);
    if (!template) continue;
    const pageNumbers = template.nodes.filter((component) => component.kind === "number");
    if (template.pageType === "章节过渡页") {
      chapterNumber += 1;
      slide.nodes ??= {};
      for (const component of pageNumbers) slide.nodes[component.key] = chapterNumber;
    }
    for (const list of template.lists) {
      const numberComponents = list.componentContract.filter((component) => component.kind === "number");
      const items = slide.lists?.[list.key] ?? [];
      for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
        for (const component of numberComponents) items[itemIndex][component.key] = itemIndex + 1;
      }
    }
  }
  return bound;
}

function cloneDeckInput(input: DeckInput): DeckInput {
  return {
    ...input,
    slides: input.slides.map((slide) => ({
      ...slide,
      nodes: slide.nodes ? { ...slide.nodes } : undefined,
      lists: slide.lists
        ? Object.fromEntries(Object.entries(slide.lists).map(([key, items]) => [key, items.map((item) => ({ ...item }))]))
        : undefined,
      sourceRefs: slide.sourceRefs ? [...slide.sourceRefs] : undefined,
    })),
  };
}

export function formatDeterministicNumber(value: NodeValue, width = 1): string {
  const raw = typeof value === "object" && value !== null && "path" in value ? value.path : String(value);
  const numeric = Number(raw);
  return Number.isFinite(numeric) ? String(numeric).padStart(width, "0") : raw;
}
