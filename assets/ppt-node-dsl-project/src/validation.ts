import { access } from "node:fs/promises";
import path from "node:path";
import type { ComponentManifest, DeckInput, NodeValue, TemplateManifest } from "./types.js";

export async function validateDeckInput(manifest: TemplateManifest, input: DeckInput): Promise<string[]> {
  const errors: string[] = [];
  if (!Array.isArray(input.slides) || !input.slides.length) return ["slides 必须是非空数组"];
  for (let slideIndex = 0; slideIndex < input.slides.length; slideIndex += 1) {
    const inputSlide = input.slides[slideIndex];
    const template = manifest.slides.find((slide) => slide.templateId === inputSlide.templateId);
    if (!template) { errors.push(`slides[${slideIndex}] templateId 不存在: ${inputSlide.templateId}`); continue; }
    const allowedNodes = new Set(template.nodes.map((node) => node.key));
    for (const key of Object.keys(inputSlide.nodes ?? {})) if (!allowedNodes.has(key)) errors.push(`${inputSlide.templateId}.nodes 不允许字段: ${key}`);
    for (const component of template.nodes) {
      const value = inputSlide.nodes?.[component.key];
      if (value === undefined) errors.push(`${inputSlide.templateId}.nodes 缺少 ${component.key}`);
      else await validateValue(component, value, `${inputSlide.templateId}.nodes.${component.key}`, errors);
    }
    const allowedLists = new Set(template.lists.map((list) => list.key));
    for (const key of Object.keys(inputSlide.lists ?? {})) if (!allowedLists.has(key)) errors.push(`${inputSlide.templateId}.lists 不允许列表: ${key}`);
    for (const list of template.lists) {
      const items = inputSlide.lists?.[list.key];
      if (!items) { errors.push(`${inputSlide.templateId}.lists 缺少 ${list.key}`); continue; }
      if (items.length < list.minItems || items.length > list.maxItems) errors.push(`${inputSlide.templateId}.${list.key} 项数 ${items.length} 不在 [${list.minItems}-${list.maxItems}]`);
      for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
        const item = items[itemIndex];
        const allowed = new Set(list.componentContract.map((component) => component.key));
        for (const key of Object.keys(item)) if (!allowed.has(key)) errors.push(`${inputSlide.templateId}.${list.key}[${itemIndex}] 不允许字段: ${key}`);
        for (const contract of list.componentContract) {
          const value = item[contract.key];
          if (value === undefined && contract.kind === "number") continue;
          if (value === undefined) { errors.push(`${inputSlide.templateId}.${list.key}[${itemIndex}] 缺少 ${contract.key}`); continue; }
          const sample = list.items[0]?.components.find((component) => component.key === contract.key);
          if (sample) await validateValue({ ...sample, ...contract }, value, `${inputSlide.templateId}.${list.key}[${itemIndex}].${contract.key}`, errors);
        }
      }
    }
  }
  validateDeckStructure(manifest, input, errors);
  validateDirectoryTransitionContract(manifest, input, errors);
  return errors;
}

function validateDeckStructure(manifest: TemplateManifest, input: DeckInput, errors: string[]): void {
  const pageTypes = input.slides.map((slide) => manifest.slides.find((candidate) => candidate.templateId === slide.templateId)?.pageType);
  const requiredPageTypes = ["封面页", "目录页", "内容页", "结尾页"] as const;
  for (const pageType of requiredPageTypes) {
    if (!pageTypes.includes(pageType)) errors.push(`整套 Deck 必须至少包含 1 张${pageType}`);
  }
  if (pageTypes[0] !== "封面页") errors.push("第一张必须是封面页");
  if (pageTypes.at(-1) !== "结尾页") errors.push("最后一张必须是结尾页");

  const directoryIndex = pageTypes.indexOf("目录页");
  const transitionIndex = pageTypes.indexOf("章节过渡页");
  if (directoryIndex >= 0 && transitionIndex >= 0 && directoryIndex > transitionIndex) {
    errors.push("目录页必须位于第一张章节过渡页之前");
  }
}

function validateDirectoryTransitionContract(manifest: TemplateManifest, input: DeckInput, errors: string[]): void {
  const resolved = input.slides.map((slide, index) => ({
    index,
    input: slide,
    template: manifest.slides.find((candidate) => candidate.templateId === slide.templateId),
  }));
  const directoryItemCount = resolved
    .filter((slide) => slide.template?.pageType === "目录页")
    .reduce((total, slide) => total + Object.values(slide.input.lists ?? {}).reduce((sum, items) => sum + items.length, 0), 0);
  const transitions = resolved.filter((slide) => slide.template?.pageType === "章节过渡页");
  if (resolved.some((slide) => slide.template?.pageType === "目录页") && directoryItemCount === 0) {
    errors.push("目录页必须至少包含 1 个目录项");
  }
  if (directoryItemCount !== transitions.length) {
    errors.push(`目录项数 ${directoryItemCount} 必须等于章节过渡页数 ${transitions.length}`);
  }
  transitions.forEach((slide, index) => {
    const numberNode = slide.template?.nodes.find((component) => component.kind === "number");
    if (!numberNode) {
      errors.push(`slides[${slide.index}] 章节过渡页缺少序号节点`);
      return;
    }
    const raw = slide.input.nodes?.[numberNode.key];
    const value = typeof raw === "object" ? Number.NaN : Number(raw);
    if (value !== index + 1) errors.push(`slides[${slide.index}] 章节序号应为 ${index + 1}，实际为 ${String(raw)}`);
  });
}

async function validateValue(component: ComponentManifest, value: NodeValue, label: string, errors: string[]): Promise<void> {
  if (component.kind === "image" || component.kind === "icon") {
    const source = typeof value === "object" ? value.path : String(value);
    if (!source) { errors.push(`${label} 资源路径为空`); return; }
    const extension = path.extname(source).toLowerCase();
    const supported = component.kind === "icon" ? [".svg", ".png"] : [".svg", ".png", ".jpg", ".jpeg", ".gif"];
    if (!supported.includes(extension)) errors.push(`${label} 不支持资源格式: ${extension || "(无扩展名)"}`);
    try { await access(source); } catch { errors.push(`${label} 资源不存在: ${source}`); }
    return;
  }
  const text = String(value);
  if (component.kind === "text" && component.length) {
    const { length, hasInvalidCharacters } = meaningfulTextLength(text);
    if (hasInvalidCharacters) {
      errors.push(`${label} 包含不可见格式字符或非标准空白，按可见内容计长度 ${length}`);
      return;
    }
    if (length < component.length.min || length > component.length.max) errors.push(`${label} 长度 ${length} 不在 [${component.length.min}-${component.length.max}]`);
  }
}

export function meaningfulTextLength(text: string): { length: number; hasInvalidCharacters: boolean } {
  let length = 0;
  let seenVisible = false;
  let pendingSpace = false;
  let hasInvalidCharacters = false;
  for (const character of text) {
    if (/\p{Cf}/u.test(character)) {
      hasInvalidCharacters = true;
      continue;
    }
    if (/\s/u.test(character)) {
      if (character !== " " && character !== "\n" && character !== "\t") hasInvalidCharacters = true;
      if (seenVisible) pendingSpace = true;
      continue;
    }
    if (pendingSpace) {
      length += 1;
      pendingSpace = false;
    }
    length += 1;
    seenVisible = true;
  }
  return { length, hasInvalidCharacters };
}

export async function assertValidDeckInput(manifest: TemplateManifest, input: DeckInput): Promise<void> {
  const errors = await validateDeckInput(manifest, input);
  if (errors.length) throw new Error(`DeckInput 校验失败:\n${errors.map((error) => `- ${error}`).join("\n")}`);
}
