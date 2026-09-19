import { validateDataValue, validatePalette } from "./pptx/data-components.js";
import { access } from "node:fs/promises";
import path from "node:path";
import type { ComponentManifest, DeckInput, NodeValue, RichTextValue, TemplateManifest } from "./types.js";
import { componentSupportsRichText, isRichTextValue, plainTextFromValue, RICH_TEXT_MAX_PARAGRAPHS, RICH_TEXT_MAX_RUNS_PER_PARAGRAPH } from "./rich-text.js";

export async function validateDeckInput(manifest: TemplateManifest, input: DeckInput): Promise<string[]> {
  return validateDeck(manifest, input, false);
}

export async function validateDeckContent(manifest: TemplateManifest, input: DeckInput): Promise<string[]> {
  return validateDeck(manifest, input, true);
}

async function validateDeck(manifest: TemplateManifest, input: DeckInput, contentOnly: boolean): Promise<string[]> {
  const errors: string[] = [];
  if (input.palette !== undefined) {
    if (contentOnly) errors.push("内容草稿不允许 palette；配色由确定性流程绑定");
    else errors.push(...validatePalette(input.palette));
  }
  if (!Array.isArray(input.slides) || !input.slides.length) return ["slides 必须是非空数组"];
  for (let slideIndex = 0; slideIndex < input.slides.length; slideIndex += 1) {
    const inputSlide = input.slides[slideIndex];
    const template = manifest.slides.find((slide) => slide.templateId === inputSlide.templateId);
    if (!template) { errors.push(`slides[${slideIndex}] templateId 不存在: ${inputSlide.templateId}`); continue; }
    if (template.pageType !== "章节过渡页" && template.nodes.some((component) => component.kind === "number")) {
      errors.push(`${inputSlide.templateId} 只有章节过渡页允许页面级序号节点`);
    }
    const nodeContracts = contentOnly ? template.nodes.filter((component) => ["text", "table", "chart"].includes(component.kind)) : template.nodes;
    const allowedNodes = new Set(nodeContracts.map((node) => node.key));
    for (const key of Object.keys(inputSlide.nodes ?? {})) if (!allowedNodes.has(key)) errors.push(`${inputSlide.templateId}.nodes 不允许字段: ${key}`);
    for (const component of nodeContracts) {
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
        const componentContracts = contentOnly ? list.componentContract.filter((component) => component.kind === "text") : list.componentContract;
        const allowed = new Set(componentContracts.map((component) => component.key));
        for (const key of Object.keys(item)) if (!allowed.has(key)) errors.push(`${inputSlide.templateId}.${list.key}[${itemIndex}] 不允许字段: ${key}`);
        for (const contract of componentContracts) {
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
  validateDirectoryTransitionContract(manifest, input, errors, !contentOnly);
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

  const directoryIndexes = pageTypes.flatMap((pageType, index) => pageType === "目录页" ? [index] : []);
  if (directoryIndexes.length !== 1) errors.push(`整套 Deck 必须恰好包含 1 张目录页，实际 ${directoryIndexes.length}`);
  if (pageTypes[1] !== "目录页") errors.push("第二张必须是目录页");

  const transitionCount = pageTypes.filter((pageType) => pageType === "章节过渡页").length;
  if (transitionCount < 3 || transitionCount > 6) errors.push(`章节数量必须在 3-6，实际 ${transitionCount}`);

  let activeChapter = 0;
  let contentCount = 0;
  for (let slideIndex = 2; slideIndex < pageTypes.length - 1; slideIndex += 1) {
    const pageType = pageTypes[slideIndex];
    if (pageType === "章节过渡页") {
      if (activeChapter > 0 && contentCount === 0) errors.push(`第 ${activeChapter} 个章节过渡页后没有内容页`);
      activeChapter += 1;
      contentCount = 0;
      continue;
    }
    if (pageType === "内容页") {
      if (activeChapter === 0) errors.push(`slides[${slideIndex}] 内容页必须位于某个章节过渡页之后`);
      else contentCount += 1;
      continue;
    }
    if (pageType !== undefined) errors.push(`目录与结尾之间只允许章节过渡页和内容页，slides[${slideIndex}]=${pageType}`);
  }
  if (activeChapter > 0 && contentCount === 0) errors.push(`第 ${activeChapter} 个章节过渡页后没有内容页`);
}

function validateDirectoryTransitionContract(manifest: TemplateManifest, input: DeckInput, errors: string[], validateNumbers: boolean): void {
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
  if (!validateNumbers) return;
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
  if (component.kind === "table" || component.kind === "chart") { errors.push(...validateDataValue(component, value).map(e => `${label}: ${e}`)); return; }
  if (component.kind === "image" || component.kind === "icon") {
    const source = typeof value === "object" && value !== null && "path" in value ? value.path : String(value);
    if (!source) { errors.push(`${label} 资源路径为空`); return; }
    const extension = path.extname(source).toLowerCase();
    const supported = component.kind === "icon" ? [".svg", ".png"] : [".svg", ".png", ".jpg", ".jpeg", ".gif"];
    if (!supported.includes(extension)) errors.push(`${label} 不支持资源格式: ${extension || "(无扩展名)"}`);
    try { await access(source); } catch { errors.push(`${label} 资源不存在: ${source}`); }
    return;
  }
  if (component.kind === "text") {
    if (typeof value !== "string" && !isRichTextValue(value)) {
      errors.push(`${label} 必须是纯文本字符串或合法富文本对象`);
      return;
    }
    if (isRichTextValue(value)) {
      if (!componentSupportsRichText(component)) {
        errors.push(`${label} 富文本仅允许用于 maxLength >= 40 的长文本框`);
        return;
      }
      if (!validateRichTextStructure(value, label, errors)) return;
    }
    if (!component.length) return;
    const text = plainTextFromValue(value);
    const { length, hasInvalidCharacters } = meaningfulTextLength(text);
    if (hasInvalidCharacters) {
      errors.push(`${label} 包含不可见格式字符或非标准空白，按可见内容计长度 ${length}`);
      return;
    }
    if (length < component.length.min || length > component.length.max) errors.push(`${label} 长度 ${length} 不在 [${component.length.min}-${component.length.max}]`);
  }
}

function validateRichTextStructure(value: RichTextValue, label: string, errors: string[]): boolean {
  let valid = true;
  if (value.paragraphs.length < 1 || value.paragraphs.length > RICH_TEXT_MAX_PARAGRAPHS) {
    errors.push(`${label}.paragraphs 项数 ${value.paragraphs.length} 不在 [1-${RICH_TEXT_MAX_PARAGRAPHS}]`);
    valid = false;
  }
  (value.paragraphs as unknown[]).forEach((paragraph, paragraphIndex) => {
    const paragraphLabel = `${label}.paragraphs[${paragraphIndex}]`;
    if (typeof paragraph !== "object" || paragraph === null) {
      errors.push(`${paragraphLabel} 必须是对象`);
      valid = false;
      return;
    }
    const paragraphRecord = paragraph as Record<string, unknown>;
    const paragraphKeys = Object.keys(paragraphRecord);
    for (const key of paragraphKeys) {
      if (key !== "list" && key !== "runs") {
        errors.push(`${paragraphLabel} 不允许字段: ${key}`);
        valid = false;
      }
    }
    if (!["none", "bullet", "number"].includes(String(paragraphRecord.list))) {
      errors.push(`${paragraphLabel}.list 必须是 none、bullet 或 number`);
      valid = false;
    }
    if (!Array.isArray(paragraphRecord.runs)) {
      errors.push(`${paragraphLabel}.runs 必须是数组`);
      valid = false;
      return;
    }
    if (paragraphRecord.runs.length < 1 || paragraphRecord.runs.length > RICH_TEXT_MAX_RUNS_PER_PARAGRAPH) {
      errors.push(`${paragraphLabel}.runs 项数 ${paragraphRecord.runs.length} 不在 [1-${RICH_TEXT_MAX_RUNS_PER_PARAGRAPH}]`);
      valid = false;
    }
    paragraphRecord.runs.forEach((run: unknown, runIndex: number) => {
      const runLabel = `${paragraphLabel}.runs[${runIndex}]`;
      if (typeof run !== "object" || run === null) {
        errors.push(`${runLabel} 必须是对象`);
        valid = false;
        return;
      }
      const runRecord = run as Record<string, unknown>;
      const runKeys = Object.keys(runRecord);
      for (const key of runKeys) {
        if (key !== "text" && key !== "bold" && key !== "underline") {
          errors.push(`${runLabel} 不允许字段: ${key}`);
          valid = false;
        }
      }
      if (typeof runRecord.text !== "string" || runRecord.text.length === 0) {
        errors.push(`${runLabel}.text 必须是非空字符串`);
        valid = false;
      } else if (/[\r\n\t]/u.test(runRecord.text)) {
        errors.push(`${runLabel}.text 不允许换行或 Tab；请拆成 paragraph`);
        valid = false;
      }
      if (typeof runRecord.bold !== "boolean") {
        errors.push(`${runLabel}.bold 必须是布尔值`);
        valid = false;
      }
      if (typeof runRecord.underline !== "boolean") {
        errors.push(`${runLabel}.underline 必须是布尔值`);
        valid = false;
      }
    });
  });
  return valid;
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
