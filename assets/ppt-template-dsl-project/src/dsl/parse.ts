import type { DslComponent, DslListComponent, LengthRange, ParsedDsl, PageType } from "../types.js";

const PAGE_TYPES: PageType[] = ["封面页", "封面", "目录页", "目录", "内容页", "结尾页", "结尾", "章节过渡页"];

export function parseDsl(rawNotes: string): ParsedDsl {
  const warnings: string[] = [];
  const normalized = normalizeNotes(rawNotes);
  const pageType = parsePageType(normalized, warnings);
  const attributesText = sliceSection(normalized, "#属性", ["#逻辑关系"]);
  const logicText = sliceSection(normalized, "#逻辑关系", []);
  const tokens = tokenizeAttributes(attributesText);
  const components: DslComponent[] = [];
  const lists: DslListComponent[] = [];
  let activeList: DslListComponent | undefined;

  for (const token of tokens) {
    const component = parseComponent(token, warnings);
    if (!component) continue;

    if (component.kind === "list") {
      const listComponent: DslListComponent = { ...component, kind: "list", itemComponents: [] };
      lists.push(listComponent);
      components.push(listComponent);
      activeList = listComponent;
      continue;
    }

    if (component.kind === "listItem") {
      activeList = lists.at(-1);
      if (!activeList) warnings.push(`发现 @列表组件-Item，但前面没有 @列表组件: ${token}`);
      continue;
    }

    if (component.scope === "listItem") {
      if (activeList) activeList.itemComponents.push(component);
      else warnings.push(`发现列表内组件，但前面没有 @列表组件-Item: ${token}`);
      continue;
    }

    components.push(component);
    activeList = undefined;
  }

  const logic = [...logicText.matchAll(/@([^@#]+)/g)]
    .map((match) => cleanLabel(match[1]))
    .filter(Boolean);

  return {
    pageType: canonicalPageType(pageType),
    components,
    lists,
    logic,
    rawNotes: normalized,
    warnings,
  };
}

function normalizeNotes(raw: string): string {
  return raw
    .replace(/\r/g, "\n")
    .replace(/[｜|]/g, "|")
    .replace(/组件—/g, "组件-")
    .replace(/长度—/g, "长度-")
    .replace(/@文字组件/g, "@文本组件")
    .replace(/@@文字组件/g, "@@文本组件")
    .replace(/@ICON组件/g, "@图标组件")
    .replace(/@@ICON组件/g, "@@图标组件")
    .replace(/\s+/g, "")
    .replace(/(\])\d+$/g, "$1")
    .replace(/(@@?序号组件)\d+$/g, "$1");
}

function parsePageType(text: string, warnings: string[]): PageType {
  const section = sliceSection(text, "#页面类型", ["#属性", "#逻辑关系"]);
  const hit = PAGE_TYPES.find((type) => section.includes(type));
  if (!hit) warnings.push(`无法识别页面类型: ${section || "(空)"}`);
  return hit || section || "未知";
}

function canonicalPageType(type: PageType): PageType {
  if (type === "封面") return "封面页";
  if (type === "目录") return "目录页";
  if (type === "结尾") return "结尾页";
  return type;
}

function sliceSection(text: string, start: string, endMarkers: string[]): string {
  const startIndex = text.indexOf(start);
  if (startIndex < 0) return "";
  const from = startIndex + start.length;
  const endIndexes = endMarkers
    .map((marker) => text.indexOf(marker, from))
    .filter((index) => index >= 0);
  const to = endIndexes.length ? Math.min(...endIndexes) : text.length;
  return text.slice(from, to);
}

function tokenizeAttributes(text: string): string[] {
  if (!text) return [];
  const matches = text.match(/@@?[^@#]+/g);
  return matches?.map((value) => value.trim()).filter(Boolean) ?? [];
}

function parseComponent(token: string, warnings: string[]): DslComponent | undefined {
  const scope: "slide" | "listItem" = token.startsWith("@@") ? "listItem" : "slide";
  const body = token.replace(/^@@?/, "");
  const normalizedBody = body.replace(/^文本组件/, "文本组件");
  const [kindText, ...rest] = normalizedBody.split("-");
  const detail = rest.join("-");

  if (kindText === "列表组件" && detail === "Item") {
    return { scope, raw: token, kind: "listItem" };
  }

  const base: DslComponent = {
    scope,
    raw: token,
    kind: resolveKind(kindText),
  };

  if (base.kind === "unknown") warnings.push(`未知组件类型: ${token}`);

  const length = parseLength(detail);
  if (length) base.length = length;
  base.label = cleanLabel(detail.replace(/长度\[[^\]]+\]/g, ""));
  if (base.kind === "image") base.imageRole = parseImageRole(detail);

  const explicitIndex = detail.match(/(?:^|-)(\d+)$/)?.[1];
  if (explicitIndex) base.index = Number(explicitIndex);

  if (!base.label && base.kind === "list") base.label = "列表";
  if (!base.label && base.kind === "number") base.label = base.index ? String(base.index).padStart(2, "0") : "序号";
  if (!base.label && base.kind === "image") base.label = base.index ? `图片${base.index}` : "图片";
  if (!base.label && base.kind === "icon") base.label = "图标";

  return base;
}

function resolveKind(kindText: string): DslComponent["kind"] {
  if (kindText === "文本组件") return "text";
  if (kindText === "图片组件") return "image";
  if (kindText === "序号组件") return "number";
  if (kindText === "列表组件") return "list";
  if (kindText === "图标组件" || kindText === "ICON组件") return "icon";
  return "unknown";
}

function parseImageRole(detail: string): "content" | "decorative" | "brand" {
  if (/品牌|标识|logo/i.test(detail)) return "brand";
  if (/装饰|背景|底纹|图标|icon/i.test(detail)) return "decorative";
  return "content";
}

function parseLength(text: string): LengthRange | undefined {
  const match = text.match(/(?:长度?-?)?\[(\d+)(?:-(\d+))?\]/);
  if (!match) return undefined;
  const min = Number(match[1]);
  const max = Number(match[2] ?? match[1]);
  return { min, max, fixed: min === max };
}

function cleanLabel(value: string): string {
  return value
    .replace(/^\-+/, "")
    .replace(/\-+$/, "")
    .replace(/\[[^\]]+\]/g, "")
    .replace(/^长度$/, "")
    .trim();
}
