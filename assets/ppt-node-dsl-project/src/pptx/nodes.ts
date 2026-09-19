import { parseComponentName, parseFixedListComponentName, parseGroupName } from "../dsl/parse.js";
import type { Box, RichTextListStyle, RichTextRunValue, RichTextValue } from "../types.js";

export interface XmlNode {
  type: "sp" | "pic" | "grpSp" | "graphicFrame";
  start: number;
  end: number;
  raw: string;
  id: string;
  name: string;
  text: string;
  relId?: string;
  box?: Box;
  path: number[];
  children: XmlNode[];
}

interface OpenNode { type: XmlNode["type"]; start: number; children: XmlNode[] }

export function parseSlideNodes(xml: string): XmlNode[] {
  const roots: XmlNode[] = [];
  const stack: OpenNode[] = [];
  const token = /<(\/?)p:(sp|pic|grpSp|graphicFrame)\b[^>]*>/g;
  let match: RegExpExecArray | null;
  while ((match = token.exec(xml))) {
    const closing = match[1] === "/";
    const type = match[2] as XmlNode["type"];
    if (!closing) { stack.push({ type, start: match.index, children: [] }); continue; }
    const open = stack.pop();
    if (!open || open.type !== type) throw new Error(`无法解析 slide XML 节点边界: ${type}`);
    const end = token.lastIndex;
    const raw = xml.slice(open.start, end);
    const node = buildNode(open.type, open.start, end, raw, open.children);
    const parent = stack.at(-1);
    if (parent) parent.children.push(node); else roots.push(node);
  }
  if (stack.length) throw new Error("slide XML 存在未闭合的形状节点");
  assignPaths(roots, []);
  return roots;
}

export function flattenNodes(nodes: XmlNode[]): XmlNode[] {
  return nodes.flatMap((node) => [node, ...flattenNodes(node.children)]);
}

export function isDslNode(node: XmlNode): boolean {
  return Boolean(parseGroupName(node.name) || parseFixedListComponentName(node.name) || parseComponentName(node.name));
}

export function replaceNodeRaw(xml: string, node: XmlNode, replacement: string): string {
  return `${xml.slice(0, node.start)}${replacement}${xml.slice(node.end)}`;
}

export function replaceTextInNode(raw: string, value: string): string {
  const escaped = xmlEscape(value);
  const bodyMatch = raw.match(/<p:txBody\b[\s\S]*?<\/p:txBody>/);
  if (!bodyMatch) return replaceTextRuns(raw, escaped);
  const paragraphs = [...bodyMatch[0].matchAll(/<a:p\b[\s\S]*?<\/a:p>/g)];
  const target = paragraphs.find((match) => /<a:t>/.test(match[0])) ?? paragraphs[0];
  if (!target) return replaceTextRuns(raw, escaped);
  const compactParagraph = replaceTextRuns(target[0].replace(/<a:br\b[^>]*\/>/g, ""), escaped);
  let kept = false;
  const compactBody = bodyMatch[0].replace(/<a:p\b[\s\S]*?<\/a:p>/g, (paragraph) => {
    if (!kept && paragraph === target[0]) { kept = true; return compactParagraph; }
    return "";
  });
  return raw.replace(bodyMatch[0], compactBody);
}

export function replaceRichTextInNode(raw: string, value: RichTextValue): string {
  const bodyMatch = raw.match(/<p:txBody\b[\s\S]*?<\/p:txBody>/);
  if (!bodyMatch) throw new Error("富文本节点缺少 p:txBody");
  const paragraphs = [...bodyMatch[0].matchAll(/<a:p\b[\s\S]*?<\/a:p>/g)];
  const target = paragraphs.find((match) => /<a:t(?:\s[^>]*)?>/.test(match[0])) ?? paragraphs[0];
  if (!target) throw new Error("富文本节点缺少模板段落");

  const templateParagraph = target[0];
  const paragraphProperties = templateParagraph.match(/<a:pPr\b[\s\S]*?<\/a:pPr>|<a:pPr\b[^>]*\/>/)?.[0];
  const runProperties = templateParagraph.match(/<a:rPr\b[\s\S]*?<\/a:rPr>|<a:rPr\b[^>]*\/>/)?.[0]
    ?? paragraphProperties?.match(/<a:defRPr\b[\s\S]*?<\/a:defRPr>|<a:defRPr\b[^>]*\/>/)?.[0]
    ?? templateParagraph.match(/<a:endParaRPr\b[\s\S]*?<\/a:endParaRPr>|<a:endParaRPr\b[^>]*\/>/)?.[0]
    ?? "<a:rPr/>";
  const endProperties = templateParagraph.match(/<a:endParaRPr\b[\s\S]*?<\/a:endParaRPr>|<a:endParaRPr\b[^>]*\/>/)?.[0] ?? "";

  let orderedIndex = 0;
  const generated = value.paragraphs.map((paragraph) => {
    orderedIndex = paragraph.list === "number" ? orderedIndex + 1 : 0;
    const pPr = buildParagraphProperties(paragraphProperties, paragraph.list, orderedIndex);
    const runs = paragraph.runs.map((run) => buildTextRun(runProperties, run)).join("");
    return `<a:p>${pPr}${runs}${endProperties}</a:p>`;
  }).join("");

  let kept = false;
  const richBody = bodyMatch[0].replace(/<a:p\b[\s\S]*?<\/a:p>/g, (paragraph) => {
    if (!kept && paragraph === templateParagraph) {
      kept = true;
      return generated;
    }
    return "";
  });
  return raw.replace(bodyMatch[0], richBody);
}

function buildTextRun(templateRunProperties: string, run: RichTextRunValue): string {
  let properties = normalizeRunProperties(templateRunProperties)
    .replace(/\s+b="[^"]*"/g, "")
    .replace(/\s+u="[^"]*"/g, "");
  if (run.bold) properties = setOpeningTagAttribute(properties, "b", "1");
  if (run.underline) properties = setOpeningTagAttribute(properties, "u", "sng");
  const preserve = /^\s|\s$/u.test(run.text) ? ' xml:space="preserve"' : "";
  return `<a:r>${properties}<a:t${preserve}>${xmlEscape(run.text)}</a:t></a:r>`;
}

function normalizeRunProperties(value: string): string {
  return value
    .replace(/<a:(?:defRPr|endParaRPr)\b/, "<a:rPr")
    .replace(/<\/a:(?:defRPr|endParaRPr)>/, "</a:rPr>");
}

function buildParagraphProperties(template: string | undefined, list: RichTextListStyle, orderedIndex: number): string {
  let properties = template ?? "<a:pPr/>";
  if (/\/>$/.test(properties)) properties = properties.replace(/\/>$/, "></a:pPr>");
  for (const tag of ["buClrTx", "buClr", "buSzTx", "buSzPct", "buSzPts", "buFontTx", "buFont", "buNone", "buAutoNum", "buChar", "buBlip"]) {
    properties = properties.replace(new RegExp(`<a:${tag}\\b[^>]*(?:\\/>|>[\\s\\S]*?<\\/a:${tag}>)`, "g"), "");
  }
  if (list !== "none") {
    properties = setOpeningTagAttribute(properties, "marL", readOpeningTagAttribute(properties, "marL") ?? "342900");
    properties = setOpeningTagAttribute(properties, "indent", readOpeningTagAttribute(properties, "indent") ?? "-285750");
  }
  const bullet = list === "bullet"
    ? '<a:buChar char="•"/>'
    : list === "number"
      ? `<a:buAutoNum type="arabicPeriod" startAt="${orderedIndex}"/>`
      : "<a:buNone/>";
  const insertionPoint = properties.search(/<a:(?:tabLst|defRPr|extLst)\b|<\/a:pPr>/);
  if (insertionPoint < 0) throw new Error("无法定位 a:pPr 的列表属性插入点");
  return `${properties.slice(0, insertionPoint)}${bullet}${properties.slice(insertionPoint)}`;
}

function readOpeningTagAttribute(xml: string, name: string): string | undefined {
  const opening = xml.match(/^<a:[^>]+>/)?.[0] ?? "";
  return opening.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];
}

function setOpeningTagAttribute(xml: string, name: string, value: string): string {
  const opening = xml.match(/^<a:[^>]+>/)?.[0];
  if (!opening) return xml;
  const attribute = new RegExp(`\\s${name}="[^"]*"`);
  const updated = attribute.test(opening)
    ? opening.replace(attribute, ` ${name}="${xmlEscape(value)}"`)
    : opening.replace(/\/?>>?$/, (ending) => ` ${name}="${xmlEscape(value)}"${ending}`);
  return `${updated}${xml.slice(opening.length)}`;
}

function replaceTextRuns(raw: string, escaped: string): string {
  let first = true;
  return raw.replace(/<a:t>([\s\S]*?)<\/a:t>/g, () => {
    const next = first ? escaped : "";
    first = false;
    return `<a:t>${next}</a:t>`;
  });
}

export function renameFirstNode(raw: string, name: string): string {
  return raw.replace(/(<p:cNvPr\b[^>]*\bname=")[^"]*(")/, `$1${xmlEscape(name)}$2`);
}

export function setGroupBox(raw: string, box: Box): string {
  const match = raw.match(/<p:grpSpPr>[\s\S]*?<\/p:grpSpPr>/);
  if (!match) return raw;
  const updated = match[0]
    .replace(/<a:off\s+x="-?\d+"\s+y="-?\d+"\/>/, `<a:off x="${Math.round(box.x)}" y="${Math.round(box.y)}"/>`)
    .replace(/<a:ext\s+cx="\d+"\s+cy="\d+"\/>/, `<a:ext cx="${Math.round(box.cx)}" cy="${Math.round(box.cy)}"/>`);
  return raw.replace(match[0], updated);
}

export function reassignShapeIds(raw: string, nextId: () => number): string {
  return raw.replace(/(<p:cNvPr\b[^>]*\bid=")[^"]+("[^>]*>)/g, `$1__ID__$2`)
    .replace(/__ID__/g, () => String(nextId()));
}

export function maxShapeId(xml: string): number {
  return Math.max(0, ...[...xml.matchAll(/<p:cNvPr\b[^>]*\bid="(\d+)"/g)].map((m) => Number(m[1])));
}

function buildNode(type: XmlNode["type"], start: number, end: number, raw: string, children: XmlNode[]): XmlNode {
  const firstTagEnd = raw.indexOf(">") + 1;
  const headerScope = type === "grpSp" ? raw.slice(0, children.length ? children[0].start - start : raw.length) : raw;
  const cNvPr = (headerScope || raw.slice(0, firstTagEnd + 1000)).match(/<p:cNvPr\b[^>]*>/)?.[0] ?? "";
  const id = cNvPr.match(/\bid="([^"]+)"/)?.[1] ?? "";
  const name = decodeXml(cNvPr.match(/\bname="([^"]*)"/)?.[1] ?? "");
  const text = [...raw.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) => decodeXml(m[1])).join("\n").trim();
  const relId = raw.match(/<a:blip\b[^>]*\br:embed="([^"]+)"/)?.[1];
  return { type, start, end, raw, id, name, text, relId, box: readBox(raw, type), path: [], children };
}

function assignPaths(nodes: XmlNode[], prefix: number[]): void {
  nodes.forEach((node, index) => { node.path = [...prefix, index]; assignPaths(node.children, node.path); });
}

function readBox(raw: string, type: XmlNode["type"]): Box | undefined {
  const scope = type === "grpSp" ? raw.match(/<p:grpSpPr>[\s\S]*?<\/p:grpSpPr>/)?.[0] ?? raw : raw;
  const off = scope.match(/<a:off\s+x="(-?\d+)"\s+y="(-?\d+)"\/>/);
  const ext = scope.match(/<a:ext\s+cx="(\d+)"\s+cy="(\d+)"\/>/);
  return off && ext ? { x: Number(off[1]), y: Number(off[2]), cx: Number(ext[1]), cy: Number(ext[2]) } : undefined;
}

function xmlEscape(value: string): string { return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function decodeXml(value: string): string { return value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&"); }
