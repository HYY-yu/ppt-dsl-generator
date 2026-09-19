import type { ComponentKind, LengthRange, PageType } from "../types.js";

export interface ParsedComponentName {
  kind: ComponentKind;
  raw: string;
  length?: LengthRange;
  numberWidth?: number;
  imageIndex?: number;
}

export interface ParsedFixedListName extends ParsedComponentName { listIndex: number; itemIndex: number }
export interface ParsedGroupName { listIndex: number; itemIndex: number; range?: LengthRange; raw: string }

export function normalizeDslName(value: string): string {
  return value.trim().replace(/＠/g, "@").replace(/\s+/g, " ").replace(/^@\s+/, "@");
}

export function parseGroupName(value: string): ParsedGroupName | undefined {
  const raw = normalizeDslName(value).replace(/\s/g, "");
  const match = raw.match(/^@(\d+)@(\d+)(?:\[(\d+)(?:-(\d+))?\])?$/);
  if (!match) return undefined;
  return {
    raw: value,
    listIndex: Number(match[1]),
    itemIndex: Number(match[2]),
    range: match[3] ? makeRange(match[3], match[4]) : undefined,
  };
}

export function parseFixedListComponentName(value: string): ParsedFixedListName | undefined {
  const normalized = normalizeDslName(value).replace(/\s/g, "");
  const match = normalized.match(/^@(\d+)@(\d+)(.+)$/);
  if (!match) return undefined;
  const component = parseComponentName(`@${match[3]}`);
  return component ? { ...component, listIndex: Number(match[1]), itemIndex: Number(match[2]) } : undefined;
}

export function parseComponentName(value: string): ParsedComponentName | undefined {
  const raw = value;
  const normalized = normalizeDslName(value).replace(/\s/g, "").replace(/^@文本框/, "@文本");
  const match = normalized.match(/^@(文本|图片|图标|序号|表格|图表)(?:-(\d+))?(?:\[(\d+)(?:-(\d+))?\])?$/);
  if (!match) return undefined;
  const kind = ({ 文本: "text", 图片: "image", 图标: "icon", 序号: "number", 表格: "table", 图表: "chart" } as const)[match[1] as "文本" | "图片" | "图标" | "序号" | "表格" | "图表"];
  if ((kind === "table" || kind === "chart") && (match[2] || match[3])) return undefined;
  const suffix = match[2];
  return {
    raw,
    kind,
    length: match[3] ? makeRange(match[3], match[4]) : undefined,
    imageIndex: kind === "image" && suffix ? Number(suffix) : undefined,
    numberWidth: kind === "number" && suffix ? suffix.length : undefined,
  };
}

export function parseNotes(raw: string): { pageType?: PageType; logic: string[] } {
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const pageAliases = new Map<string, PageType>([
    ["封面", "封面页"], ["封面页", "封面页"], ["目录", "目录页"], ["目录页", "目录页"],
    ["章节过渡", "章节过渡页"], ["章节过渡页", "章节过渡页"], ["内容", "内容页"], ["内容页", "内容页"],
    ["结尾", "结尾页"], ["结尾页", "结尾页"],
  ]);
  let pageType: PageType | undefined;
  let inLogic = false;
  const logic: string[] = [];
  for (const line of lines) {
    const clean = line.replace(/^[@#]/, "").trim();
    if (/逻辑关系/.test(clean)) { inLogic = true; continue; }
    const page = pageAliases.get(clean);
    if (page) { pageType = page; inLogic = false; continue; }
    if (inLogic && clean && !/^(页面类型|属性)$/.test(clean)) logic.push(clean);
  }
  return { pageType, logic: [...new Set(logic)] };
}

function makeRange(minText: string, maxText?: string): LengthRange {
  const min = Number(minText);
  const max = Number(maxText ?? minText);
  return { min, max, fixed: min === max };
}
