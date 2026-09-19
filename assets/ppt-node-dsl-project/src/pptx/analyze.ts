import { inspectDataComponent } from "./data-components.js";
import type JSZip from "jszip";
import { parseComponentName, parseFixedListComponentName, parseGroupName, parseNotes, type ParsedComponentName } from "../dsl/parse.js";
import type { ComponentManifest, ListItemManifest, ListManifest, SlideManifest, TemplateManifest } from "../types.js";
import { maybeReadZipText, readZipText } from "./read.js";
import { parsePresentationSlideRelIds, parseRelationships, relationshipPartForOwner, resolveRelationshipTarget } from "./relationships.js";
import { flattenNodes, parseSlideNodes, type XmlNode } from "./nodes.js";

export async function analyzeTemplate(zip: JSZip, sourceTemplate: string): Promise<TemplateManifest> {
  const presentationXml = await readZipText(zip, "ppt/presentation.xml");
  const presentationRels = parseRelationships(await readZipText(zip, "ppt/_rels/presentation.xml.rels"));
  const relById = new Map(presentationRels.map((rel) => [rel.id, rel]));
  const ordered = parsePresentationSlideRelIds(presentationXml).map((relId, index) => {
    const rel = relById.get(relId);
    if (!rel || !rel.type.endsWith("/slide")) throw new Error(`presentation.xml 的 ${relId} 不是有效 slide`);
    return { slideNumber: index + 1, relId, slidePath: resolveRelationshipTarget("ppt/presentation.xml", rel.target) };
  });

  const slides: SlideManifest[] = [];
  for (const entry of ordered) slides.push(await analyzeSlide(zip, entry));
  return { sourceTemplate, generatedAt: new Date().toISOString(), slideCount: slides.length, slides };
}

async function analyzeSlide(
  zip: JSZip,
  entry: { slideNumber: number; relId: string; slidePath: string },
): Promise<SlideManifest> {
  const slideXml = await readZipText(zip, entry.slidePath);
  const roots = parseSlideNodes(slideXml);
  const allNodes = flattenNodes(roots);
  const notes = parseNotes(await readNotesText(zip, entry.slidePath));
  const warnings: string[] = [];
  const slideRels = await readSlideRelationshipTargets(zip, entry.slidePath);
  if (!notes.pageType) warnings.push(`ERROR: 第 ${entry.slideNumber} 页缺少有效页面类型`);

  const variableGroups = allNodes.filter((node) => node.type === "grpSp" && parseGroupName(node.name));
  const variablePaths = variableGroups.map((node) => node.path);
  const lists: ListManifest[] = [];
  const variableByList = new Map<number, XmlNode[]>();
  for (const group of variableGroups) {
    const parsed = parseGroupName(group.name)!;
    const bucket = variableByList.get(parsed.listIndex) ?? [];
    bucket.push(group);
    variableByList.set(parsed.listIndex, bucket);
  }
  for (const [listIndex, groups] of [...variableByList].sort((a, b) => a[0] - b[0])) {
    lists.push(buildDynamicList(entry.slideNumber, listIndex, groups, slideRels, warnings));
  }

  const fixedCandidates = allNodes.filter((node) => {
    if (isUnderAnyPath(node.path, variablePaths)) return false;
    return Boolean(parseFixedListComponentName(node.name));
  });
  const fixedByList = new Map<number, XmlNode[]>();
  for (const node of fixedCandidates) {
    const parsed = parseFixedListComponentName(node.name)!;
    const bucket = fixedByList.get(parsed.listIndex) ?? [];
    bucket.push(node);
    fixedByList.set(parsed.listIndex, bucket);
  }
  for (const [listIndex, nodes] of [...fixedByList].sort((a, b) => a[0] - b[0])) {
    if (variableByList.has(listIndex)) {
      const evidence = nodes.map((node) => `shapeId=${node.id || "?"} ${node.name}`).join("; ");
      warnings.push(`ERROR: 第 ${entry.slideNumber} 页列表 ${listIndex} 同时使用 Group DSL 和旧式节点 DSL: ${evidence}`);
    } else {
      lists.push(buildFixedList(entry.slideNumber, listIndex, nodes, slideRels, warnings));
    }
  }

  const standaloneCounts = new Map<string, number>();
  const nodes: ComponentManifest[] = [];
  for (const node of allNodes) {
    if (isUnderAnyPath(node.path, variablePaths)) continue;
    if (parseGroupName(node.name) || parseFixedListComponentName(node.name)) continue;
    const parsed = parseComponentName(node.name);
    if (!parsed) continue;
    const ordinal = (standaloneCounts.get(parsed.kind) ?? 0) + 1;
    standaloneCounts.set(parsed.kind, ordinal);
    const component = toComponent(node, `${parsed.kind}_${ordinal}`, ordinal, parsed, slideRels);
    if (parsed.kind === "table" || parsed.kind === "chart") {
      try { Object.assign(component, await inspectDataComponent(zip, entry.slidePath, node, parsed.kind)); }
      catch (error) { warnings.push(`ERROR: 第 ${entry.slideNumber} 页 shapeId=${node.id}: ${String(error)}`); }
    }
    nodes.push(component);
  }

  for (const node of allNodes.filter((candidate) => candidate.name.trim().startsWith("@"))) {
    if (parseGroupName(node.name) || parseFixedListComponentName(node.name) || parseComponentName(node.name)) continue;
    warnings.push(`ERROR: 第 ${entry.slideNumber} 页 shapeId=${node.id || "?"} 无法解析 DSL: ${node.name}`);
  }

  return {
    templateId: `slide_${String(entry.slideNumber).padStart(3, "0")}`,
    slideNumber: entry.slideNumber,
    slidePath: entry.slidePath,
    relId: entry.relId,
    pageType: notes.pageType ?? "内容页",
    logic: notes.logic,
    nodes,
    lists: lists.sort((a, b) => a.listIndex - b.listIndex),
    warnings,
  };
}

function buildDynamicList(
  slideNumber: number,
  listIndex: number,
  unorderedGroups: XmlNode[],
  rels: Map<string, string>,
  warnings: string[],
): ListManifest {
  const groups = [...unorderedGroups].sort((a, b) => parseGroupName(a.name)!.itemIndex - parseGroupName(b.name)!.itemIndex);
  const firstParsed = parseGroupName(groups[0].name)!;
  if (firstParsed.itemIndex !== 1) {
    warnings.push(`ERROR: 第 ${slideNumber} 页 Group 列表 ${listIndex} 的第一组必须从 @${listIndex}@1 开始`);
  }
  groups.slice(1).forEach((group) => {
    if (parseGroupName(group.name)?.range) warnings.push(`ERROR: 第 ${slideNumber} 页列表 ${listIndex} 只有第一组可以声明范围`);
  });
  const items = groups.map((group) => buildDynamicItem(group, rels));
  alignItemsToFirstContract(items, slideNumber, listIndex, warnings);
  inheritAndValidateContract(slideNumber, listIndex, items, warnings);
  const range = firstParsed.range ?? { min: groups.length, max: groups.length, fixed: true };
  const indexes = groups.map((group) => parseGroupName(group.name)!.itemIndex);
  const expected = Array.from({ length: groups.length }, (_, index) => index + 1);
  if (indexes.join(",") !== expected.join(",")) warnings.push(`ERROR: 第 ${slideNumber} 页列表 ${listIndex} 的 Group 项序号不连续`);
  return {
    key: `list_${listIndex}`,
    listIndex,
    dynamic: true,
    minItems: range.min,
    maxItems: range.max,
    layout: inferLayout(groups),
    items,
    componentContract: contractFromFirst(items),
  };
}

function buildDynamicItem(group: XmlNode, rels: Map<string, string>): ListItemManifest {
  const parsedGroup = parseGroupName(group.name)!;
  const counts = new Map<string, number>();
  const descendants = flattenNodes(group.children).filter((node) => parseComponentName(node.name));
  const components = descendants.map((node) => {
    const parsed = parseComponentName(node.name)!;
    if (parsed.kind === "table" || parsed.kind === "chart") throw new Error("表格和图表暂只支持页面级节点");
    const ordinal = (counts.get(parsed.kind) ?? 0) + 1;
    counts.set(parsed.kind, ordinal);
    return toComponent(node, `${parsed.kind}_${ordinal}`, ordinal, parsed, rels);
  });
  return { itemIndex: parsedGroup.itemIndex, groupLocator: locatorFor(group, rels), components };
}

function buildFixedList(
  slideNumber: number,
  listIndex: number,
  nodes: XmlNode[],
  rels: Map<string, string>,
  warnings: string[],
): ListManifest {
  const byItem = new Map<number, XmlNode[]>();
  for (const node of nodes) {
    const parsed = parseFixedListComponentName(node.name)!;
    const bucket = byItem.get(parsed.itemIndex) ?? [];
    bucket.push(node);
    byItem.set(parsed.itemIndex, bucket);
  }
  const items = [...byItem].sort((a, b) => a[0] - b[0]).map(([itemIndex, itemNodes]) => {
    const counts = new Map<string, number>();
    const components = itemNodes.map((node) => {
      const parsed = parseFixedListComponentName(node.name)!;
      if (parsed.kind === "table" || parsed.kind === "chart") throw new Error("表格和图表暂只支持页面级节点");
      const ordinal = (counts.get(parsed.kind) ?? 0) + 1;
      counts.set(parsed.kind, ordinal);
      return toComponent(node, `${parsed.kind}_${ordinal}`, ordinal, parsed, rels);
    });
    return { itemIndex, components };
  });
  alignItemsToFirstContract(items, slideNumber, listIndex, warnings);
  inheritAndValidateContract(slideNumber, listIndex, items, warnings);
  return {
    key: `list_${listIndex}`,
    listIndex,
    dynamic: false,
    minItems: items.length,
    maxItems: items.length,
    layout: inferLayout(nodes),
    items,
    componentContract: contractFromFirst(items),
  };
}

/**
 * PowerPoint does not guarantee identical XML order for visually equivalent
 * nodes in repeated items. Match later same-kind components to the first item
 * using the declared content range and the node box dimensions, then inherit
 * the first item's stable key/ordinal contract.
 */
function alignItemsToFirstContract(items: ListItemManifest[], slideNumber: number, listIndex: number, warnings: string[]): void {
  const first = items[0]?.components;
  if (!first?.length) return;
  for (const item of items.slice(1)) {
    const aligned: ComponentManifest[] = [];
    for (const kind of [...new Set(first.map((component) => component.kind))]) {
      const contract = first.filter((component) => component.kind === kind);
      const candidates = item.components.filter((component) => component.kind === kind);
      if (contract.length !== candidates.length) {
        aligned.push(...candidates);
        continue;
      }
      const { assignment, ambiguous } = bestAssignment(contract, candidates);
      if (ambiguous) {
        warnings.push(`ERROR: 第 ${slideNumber} 页列表 ${listIndex} 第 ${item.itemIndex} 项的 ${kind} 组件无法唯一匹配第一项；请调整长度范围或节点框尺寸`);
      }
      for (let index = 0; index < contract.length; index += 1) {
        const source = contract[index];
        const candidate = assignment[index];
        aligned.push({
          ...candidate,
          key: source.key,
          ordinal: source.ordinal,
          length: candidate.length ?? source.length,
          numberWidth: candidate.numberWidth ?? source.numberWidth,
          imageIndex: candidate.imageIndex ?? source.imageIndex,
        });
      }
    }
    item.components = first.map((source) => aligned.find((component) => component.key === source.key)!).filter(Boolean);
  }
}

function bestAssignment(contract: ComponentManifest[], candidates: ComponentManifest[]): { assignment: ComponentManifest[]; ambiguous: boolean } {
  let best = candidates;
  let bestScore = Number.POSITIVE_INFINITY;
  let bestCount = 0;
  for (const permutation of permutations(candidates)) {
    const score = contract.reduce((sum, source, index) => sum + componentMatchScore(source, permutation[index]), 0);
    if (score < bestScore - 1e-9) { best = permutation; bestScore = score; bestCount = 1; }
    else if (Math.abs(score - bestScore) <= 1e-9) bestCount += 1;
  }
  return { assignment: best, ambiguous: candidates.length > 1 && bestCount > 1 };
}

function componentMatchScore(source: ComponentManifest, candidate: ComponentManifest): number {
  let score = 0;
  if (source.length) {
    const sampleLength = [...candidate.sampleContent.replace(/\s/g, "")].length;
    if (sampleLength < source.length.min || sampleLength > source.length.max) score += 1000;
  }
  const a = source.locator.box;
  const b = candidate.locator.box;
  if (a && b) {
    score += Math.abs(Math.log(Math.max(b.cx, 1) / Math.max(a.cx, 1)));
    score += Math.abs(Math.log(Math.max(b.cy, 1) / Math.max(a.cy, 1)));
  }
  if (source.imageIndex !== undefined && candidate.imageIndex !== undefined && source.imageIndex !== candidate.imageIndex) score += 100;
  return score;
}

function permutations<T>(values: T[]): T[][] {
  if (values.length <= 1) return [values];
  return values.flatMap((value, index) => permutations([...values.slice(0, index), ...values.slice(index + 1)]).map((tail) => [value, ...tail]));
}

function inheritAndValidateContract(slideNumber: number, listIndex: number, items: ListItemManifest[], warnings: string[]): void {
  const first = items[0]?.components ?? [];
  if (!first.length) warnings.push(`ERROR: 第 ${slideNumber} 页列表 ${listIndex} 的第一项没有 DSL 组件`);
  const signature = first.map((component) => `${component.kind}:${component.ordinal}`).join("|");
  for (const item of items) {
    const current = item.components.map((component) => `${component.kind}:${component.ordinal}`).join("|");
    if (current !== signature) warnings.push(`ERROR: 第 ${slideNumber} 页列表 ${listIndex} 第 ${item.itemIndex} 项组件结构与第一项不一致: expected=${signature || "(空)"} actual=${current || "(空)"}`);
    for (const component of item.components) {
      const source = first.find((candidate) => candidate.key === component.key);
      if (!source) continue;
      if (!component.length) component.length = source.length;
      if (!component.numberWidth) component.numberWidth = source.numberWidth;
      if (component.length && source.length && (component.length.min !== source.length.min || component.length.max !== source.length.max)) {
        warnings.push(`ERROR: 第 ${slideNumber} 页列表 ${listIndex} 的 ${component.key} 长度声明不一致`);
      }
    }
  }
}

function contractFromFirst(items: ListItemManifest[]): ListManifest["componentContract"] {
  return (items[0]?.components ?? []).map(({ key, kind, ordinal, sampleContent, length, numberWidth, imageIndex }) => ({ key, kind, ordinal, sampleContent, length, numberWidth, imageIndex }));
}

function toComponent(
  node: XmlNode,
  key: string,
  ordinal: number,
  parsed: ParsedComponentName,
  rels: Map<string, string>,
): ComponentManifest {
  return {
    key,
    kind: parsed.kind,
    ordinal,
    rawDsl: parsed.raw,
    sampleContent: node.text,
    length: parsed.length,
    numberWidth: parsed.numberWidth,
    imageIndex: parsed.imageIndex,
    locator: locatorFor(node, rels),
  };
}

function locatorFor(node: XmlNode, rels: Map<string, string>) {
  return {
    shapeId: node.id,
    shapeName: node.name,
    nodeType: node.type,
    path: node.path,
    box: node.box,
    relId: node.relId,
    mediaTarget: node.relId ? rels.get(node.relId) : undefined,
  };
}

function inferLayout(nodes: XmlNode[]): "row" | "column" {
  const boxes = nodes.map((node) => node.box).filter((box): box is NonNullable<XmlNode["box"]> => Boolean(box));
  if (boxes.length < 2) return "row";
  const centersX = boxes.map((box) => box.x + box.cx / 2);
  const centersY = boxes.map((box) => box.y + box.cy / 2);
  return Math.max(...centersX) - Math.min(...centersX) >= Math.max(...centersY) - Math.min(...centersY) ? "row" : "column";
}

function isUnderAnyPath(path: number[], ancestors: number[][]): boolean {
  return ancestors.some((ancestor) => path.length > ancestor.length && ancestor.every((value, index) => path[index] === value));
}

async function readNotesText(zip: JSZip, slidePath: string): Promise<string> {
  const relXml = await maybeReadZipText(zip, relationshipPartForOwner(slidePath));
  if (!relXml) return "";
  const notesRel = parseRelationships(relXml).find((rel) => rel.type.endsWith("/notesSlide"));
  if (!notesRel) return "";
  const notesPath = resolveRelationshipTarget(slidePath, notesRel.target);
  const xml = await maybeReadZipText(zip, notesPath);
  if (!xml) return "";
  return [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((match) => decodeXml(match[1])).join("\n");
}

async function readSlideRelationshipTargets(zip: JSZip, slidePath: string): Promise<Map<string, string>> {
  const xml = await maybeReadZipText(zip, relationshipPartForOwner(slidePath));
  return new Map((xml ? parseRelationships(xml) : []).map((rel) => [rel.id, rel.target]));
}

function decodeXml(value: string): string { return value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&"); }
