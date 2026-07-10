import type { Box, DeckInputSlide, ListManifest, SlideManifest } from "../types.js";
import { canPaginateList } from "../validation.js";
import { textFromATags, xmlEscape } from "./xml.js";

interface XmlBlock {
  xml: string;
  tag: "p:sp" | "p:pic" | "p:cxnSp";
  index: number;
  box?: Box;
  text: string;
}

interface ItemGroup {
  index: number;
  box: Box;
  blocks: XmlBlock[];
}

type LayoutKind = "row" | "column" | "grid" | "timeline" | "free";

const GAP_RATIO = 0.08;

export function applyDynamicLists(slideXml: string, slide: SlideManifest, input: DeckInputSlide): string {
  let xml = slideXml;
  for (const list of slide.lists) {
    const items = input.lists?.[list.key];
    if (!items) continue;
    if (!items.length) continue;

    const allowed = list.component.length;
    if (allowed?.fixed && items.length !== allowed.min) {
      throw new Error(`${slide.templateId} ${list.key} 需要固定 ${allowed.min} 项，实际 ${items.length} 项`);
    }
    if (allowed && items.length < allowed.min) {
      throw new Error(`${slide.templateId} ${list.key} 至少需要 ${allowed.min} 项，实际 ${items.length} 项`);
    }

    const maxPerPage = effectiveMaxPerPage(list, items.length);
    if (items.length > maxPerPage) {
      // Deck-level pagination happens before generation. Per-slide patch keeps the current page slice.
      console.warn(`[generate] ${slide.templateId} ${list.key} 当前页只渲染前 ${maxPerPage} 项，超量拆页应在 deck expansion 阶段处理`);
    }

    xml = rebuildListOnSlide(xml, list, items.slice(0, maxPerPage));
  }
  return xml;
}

export function expandOverflowSlides(manifest: { slides: SlideManifest[] }, inputSlides: DeckInputSlide[]): DeckInputSlide[] {
  const expanded: DeckInputSlide[] = [];
  for (const [sourceIndex, slideInput] of inputSlides.entries()) {
    const templateSlide = manifest.slides.find((slide) => slide.templateId === slideInput.templateId);
    if (!templateSlide) {
      expanded.push(slideInput);
      continue;
    }

    const overflowLists = templateSlide.lists.filter((list) => {
      const items = slideInput.lists?.[list.key] ?? [];
      const max = effectiveMaxPerPage(list, items.length);
      return max > 0 && items.length > max;
    });

    if (!overflowLists.length) {
      expanded.push(slideInput);
      continue;
    }

    if (overflowLists.length > 1) {
      throw new Error(`${templateSlide.templateId} 同时有多个列表超出单页容量，请在 DeckInput 中先拆成独立页面`);
    }

    const overflowList = overflowLists[0];
    if (!canPaginateList(overflowList)) {
      throw new Error(`${templateSlide.templateId} ${overflowList.key} 超出容量且无法安全自动拆页`);
    }

    const items = slideInput.lists?.[overflowList.key] ?? [];
    const max = effectiveMaxPerPage(overflowList, items.length);
    const min = overflowList.component.length?.min ?? 1;
    const chunks = partitionBalanced(items, min, max, templateSlide.templateId, overflowList.key);
    for (const [partIndex, chunk] of chunks.entries()) {
      expanded.push({
        ...slideInput,
        fields: rewritePaginationFields(templateSlide, slideInput.fields ?? {}, chunk.length, partIndex + 1, chunks.length),
        lists: {
          ...(slideInput.lists ?? {}),
          [overflowList.key]: chunk,
        },
        continuation: {
          sourceIndex,
          part: partIndex + 1,
          total: chunks.length,
        },
      });
    }
  }
  return expanded;
}

function partitionBalanced<T>(items: T[], min: number, max: number, templateId: string, listKey: string): T[][] {
  const pageCount = Math.ceil(items.length / max);
  if (items.length < pageCount * min) {
    throw new Error(`${templateId} ${listKey} 无法按每页 ${min}-${max} 项拆分 ${items.length} 项`);
  }
  const base = Math.floor(items.length / pageCount);
  const remainder = items.length % pageCount;
  const chunks: T[][] = [];
  let offset = 0;
  for (let index = 0; index < pageCount; index += 1) {
    const size = base + (index < remainder ? 1 : 0);
    chunks.push(items.slice(offset, offset + size));
    offset += size;
  }
  return chunks;
}

function rewritePaginationFields(
  slide: SlideManifest,
  fields: Record<string, string | number>,
  itemCount: number,
  part: number,
  total: number,
): Record<string, string | number> {
  const rewritten = { ...fields };
  for (const field of slide.fields) {
    if (!/标题|title/i.test(field.key)) continue;
    const value = rewritten[field.key];
    if (value === undefined) continue;
    let text = String(value)
      .replace(/\d+(?=\s*(?:个|项|步|阶段|模块|要点|策略|动作))/, String(itemCount))
      .replace(/(?:十[一二三四五六七八九]?|[一二三四五六七八九])(?=\s*(?:个|项|步|阶段|模块|要点|策略|动作))/, numberToHan(itemCount));
    const withSuffix = `${text}（${part}/${total}）`;
    const maxLength = field.component.length?.max;
    if (!maxLength || [...withSuffix].length <= maxLength) text = withSuffix;
    rewritten[field.key] = text;
  }
  return rewritten;
}

function numberToHan(value: number): string {
  const digits = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
  if (value < 10) return digits[value] ?? String(value);
  if (value < 20) return value === 10 ? "十" : `十${digits[value - 10]}`;
  if (value < 100) return `${digits[Math.floor(value / 10)]}十${value % 10 ? digits[value % 10] : ""}`;
  return String(value);
}

function effectiveMaxPerPage(list: ListManifest, requestedCount: number): number {
  const dslMax = list.component.length?.max ?? Math.max(list.maxItemsInTemplate, requestedCount);
  if (canSafelyExpandList(list)) return dslMax;
  return Math.min(dslMax, Math.max(list.maxItemsInTemplate, 1));
}

function canSafelyExpandList(list: ListManifest): boolean {
  if (!list.itemFields.length || list.maxItemsInTemplate <= 0) return false;
  return list.itemFields.every((field) => field.targets.length >= list.maxItemsInTemplate);
}

function rebuildListOnSlide(slideXml: string, list: ListManifest, items: Array<Record<string, string | number>>): string {
  if (items.length === list.maxItemsInTemplate) {
    return replaceListTextOnly(slideXml, list, items);
  }

  if (isCycleRadialList(list)) {
    return rebuildCycleRadialListOnSlide(slideXml, list, items);
  }

  const blocks = extractXmlBlocks(slideXml);
  const groups = inferItemGroups(blocks, list);
  if (groups.length < 2) return replaceListTextOnly(slideXml, list, items);

  const layoutKind = inferLayoutKind(groups, list);
  const slots = items.length < groups.length
    ? computeReductionSlots(groups, items.length, layoutKind)
    : computeSlots(unionBoxes(groups.map((group) => group.box)), groups, items.length, layoutKind);
  const preserveScale = items.length < groups.length;
  const removeIndexes = new Set(groups.flatMap((group) => group.blocks.map((block) => block.index)));
  const prototypeGroups = groups.length ? groups : [groups[0]];
  const globalScale = preserveScale ? 1 : computeGlobalFitScale(prototypeGroups, slots, items.length);
  let nextShapeId = maxShapeId(slideXml) + 1;
  const generated: string[] = [];

  for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
    const sourceGroup = prototypeGroups[Math.min(itemIndex, prototypeGroups.length - 1)] ?? prototypeGroups[0];
    const slot = slots[itemIndex];
    if (!sourceGroup || !slot) continue;
    const scale = globalScale;
    for (const block of sourceGroup.blocks) {
      let cloned = moveBlockToSlot(block.xml, sourceGroup.box, slot, scale);
      cloned = assignNewShapeIdentity(cloned, () => nextShapeId++);
      cloned = replaceListItemTexts(cloned, list, items[itemIndex]);
      cloned = replaceImplicitNumberText(cloned, itemIndex);
      generated.push(cloned);
    }
  }

  const cleanedXml = slideXml.replace(/<p:(?:sp|pic|cxnSp)\b[\s\S]*?<\/p:(?:sp|pic|cxnSp)>/g, (blockXml) => {
    const block = blocks.find((candidate) => candidate.xml === blockXml);
    if (!block) return blockXml;
    if (!removeIndexes.has(block.index)) return blockXml;
    return "";
  });
  return appendGeneratedBlocksToTop(cleanedXml, generated.join(""));
}

function rebuildCycleRadialListOnSlide(
  slideXml: string,
  list: ListManifest,
  items: Array<Record<string, string | number>>,
): string {
  const blocks = extractXmlBlocks(slideXml);
  const circleBlocks = inferCycleCircleBlocks(blocks, list.maxItemsInTemplate);
  if (circleBlocks.length < 2) return replaceListTextOnly(slideXml, list, items);
  const centers = circleBlocks
    .map((block) => boxCenter(block.box))
    .filter((center): center is { x: number; y: number } => Boolean(center));
  const arrowGroups = inferCycleArrowGroups(blocks, centers);
  const arrowIndexes = new Set(arrowGroups.flatMap((group) => group.blocks.map((block) => block.index)));
  const groups = inferCycleNodeGroups(
    blocks.filter((block) => !arrowIndexes.has(block.index)),
    circleBlocks,
  );
  if (groups.length < 2) return replaceListTextOnly(slideXml, list, items);

  const slots = items.length < groups.length
    ? computeReductionSlots(groups, items.length, "row")
    : computeSlots(unionBoxes(groups.map((group) => group.box)), groups, items.length, "row");
  const preserveScale = items.length < groups.length;
  const prototypeGroups = groups.length ? groups : [groups[0]];
  const globalScale = preserveScale ? 1 : computeGlobalFitScale(prototypeGroups, slots, items.length);
  const removeIndexes = new Set([
    ...groups.flatMap((group) => group.blocks.map((block) => block.index)),
    ...arrowIndexes,
  ]);
  let nextShapeId = maxShapeId(slideXml) + 1;
  const generated: string[] = [];

  for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
    const sourceGroup = prototypeGroups[Math.min(itemIndex, prototypeGroups.length - 1)] ?? prototypeGroups[0];
    const slot = slots[itemIndex];
    if (!sourceGroup || !slot) continue;
    for (const block of sourceGroup.blocks) {
      let cloned = moveBlockToSlot(block.xml, sourceGroup.box, slot, globalScale);
      cloned = assignNewShapeIdentity(cloned, () => nextShapeId++);
      cloned = replaceListItemTexts(cloned, list, items[itemIndex]);
      generated.push(cloned);
    }
  }

  const sourceArrowCenterY = arrowGroups[0]?.box ? boxCenter(arrowGroups[0].box)?.y : undefined;
  const sourceNodeCenterY = groups[0]?.box ? boxCenter(groups[0].box)?.y : undefined;
  const arrowOffsetY = sourceArrowCenterY !== undefined && sourceNodeCenterY !== undefined
    ? sourceArrowCenterY - sourceNodeCenterY
    : 0;
  for (let index = 0; index < items.length - 1; index += 1) {
    const sourceGroup = arrowGroups[Math.min(index, arrowGroups.length - 1)];
    const left = slots[index];
    const right = slots[index + 1];
    if (!sourceGroup || !left || !right) continue;
    const leftCenter = boxCenter(left);
    const rightCenter = boxCenter(right);
    if (!leftCenter || !rightCenter) continue;
    const targetCenterX = (leftCenter.x + rightCenter.x) / 2;
    const targetCenterY = ((leftCenter.y + rightCenter.y) / 2) + arrowOffsetY * globalScale;
    const targetSlot = {
      x: Math.round(targetCenterX - (sourceGroup.box.cx * globalScale) / 2),
      y: Math.round(targetCenterY - (sourceGroup.box.cy * globalScale) / 2),
      cx: Math.round(sourceGroup.box.cx * globalScale),
      cy: Math.round(sourceGroup.box.cy * globalScale),
    };
    for (const block of sourceGroup.blocks) {
      let cloned = moveBlockToSlot(block.xml, sourceGroup.box, targetSlot, globalScale);
      cloned = assignNewShapeIdentity(cloned, () => nextShapeId++);
      generated.push(cloned);
    }
  }

  const cleanedXml = slideXml.replace(/<p:(?:sp|pic|cxnSp)\b[\s\S]*?<\/p:(?:sp|pic|cxnSp)>/g, (blockXml) => {
    const block = blocks.find((candidate) => candidate.xml === blockXml);
    if (!block) return blockXml;
    return removeIndexes.has(block.index) ? "" : blockXml;
  });
  return appendGeneratedBlocksToTop(cleanedXml, generated.join(""));
}

function isTimelineList(list: ListManifest): boolean {
  const logic = `${list.component.raw} ${list.component.label ?? ""}`;
  return /时间轴|阶段|数字和箭头/.test(logic);
}

function isCycleRadialList(list: ListManifest): boolean {
  const logic = `${list.component.raw} ${list.component.label ?? ""}`;
  return /圆形大盘|循环|Cycle|Radial|小箭头/i.test(logic) && !isTimelineList(list);
}

function replaceListTextOnly(slideXml: string, list: ListManifest, items: Array<Record<string, string | number>>): string {
  let xml = slideXml;
  for (const itemField of list.itemFields) {
    itemField.targets.forEach((target, index) => {
      const value = items[index]?.[itemField.key];
      if (value === undefined) return;
      xml = replaceBlockTextByShapeIndex(xml, target.shapeIndex, String(value));
    });
  }
  return xml;
}

function extractXmlBlocks(slideXml: string): XmlBlock[] {
  const blocks: XmlBlock[] = [];
  let index = 0;
  for (const match of slideXml.matchAll(/<p:(sp|pic|cxnSp)\b[\s\S]*?<\/p:\1>/g)) {
    const tag = `p:${match[1]}` as XmlBlock["tag"];
    const xml = match[0];
    blocks.push({
      xml,
      tag,
      index,
      box: readBox(xml),
      text: textFromATags(xml),
    });
    index += 1;
  }
  return blocks;
}

function inferItemGroups(blocks: XmlBlock[], list: ListManifest): ItemGroup[] {
  const count = list.maxItemsInTemplate;
  if (count <= 0) return [];

  const anchors = buildListAnchors(list);

  const presentAnchors = anchors.filter((box): box is Box => Boolean(box));
  if (!presentAnchors.length) return [];
  const layoutKind = inferLayoutKindFromBoxes(presentAnchors, list);
  const region = expandBox(unionBoxes(presentAnchors), 0.18);
  const centers = anchors.map((box) => boxCenter(box));
  const bands = computeAssignmentBands(centers, region, layoutKind);
  const assigned = new Map<number, XmlBlock[]>();

  for (const block of blocks) {
    if (!block.box) continue;
    const blockCenter = boxCenter(block.box);
    if (!blockCenter) continue;
    if (layoutKind === "timeline" && isTimelineGlobalBlock(block, region, centers.length)) continue;
    if (!boxIntersects(region, block.box) && !pointInBox(region, blockCenter)) continue;
    const nearest = nearestCenterIndexInBand(blockCenter, centers, bands, layoutKind);
    if (nearest < 0) continue;
    const anchor = anchors[nearest];
    if (!anchor) continue;
    const anchorCenter = boxCenter(anchor);
    if (!anchorCenter) continue;
    const distance = pointDistance(blockCenter, anchorCenter);
    const maxDistance = layoutKind === "grid"
      ? Math.max(region.cx, region.cy) * 0.45
      : Math.max(region.cx, region.cy) * 0.85;
    if (distance > maxDistance) continue;
    const group = assigned.get(nearest) ?? [];
    group.push(block);
    assigned.set(nearest, group);
  }

  const groups = anchors
    .map((anchor, index) => {
      const groupBlocks = assigned.get(index) ?? [];
      const boxes = groupBlocks.map((block) => block.box).filter((box): box is Box => Boolean(box));
      if (!anchor || !groupBlocks.length || !boxes.length) return undefined;
      return { index, box: unionBoxes(boxes), blocks: groupBlocks.sort((a, b) => a.index - b.index) };
    })
    .filter((group): group is ItemGroup => Boolean(group));
  return groups;
}

function buildListAnchors(list: ListManifest): Array<Box | undefined> {
  return Array.from({ length: list.maxItemsInTemplate }, (_, index) => {
    const targetBoxes = list.itemFields
      .map((field) => field.targets[index])
      .filter(Boolean)
      .map((target) => optionalBox(target))
      .filter((box): box is Box => Boolean(box));
    return targetBoxes.length ? unionBoxes(targetBoxes) : undefined;
  });
}

function inferCycleArrowGroups(blocks: XmlBlock[], centers: Array<{ x: number; y: number }>): ItemGroup[] {
  if (centers.length < 2) return [];
  const groups: ItemGroup[] = [];
  const used = new Set<number>();

  for (let index = 0; index < centers.length - 1; index += 1) {
    const midpoint = {
      x: (centers[index].x + centers[index + 1].x) / 2,
      y: (centers[index].y + centers[index + 1].y) / 2,
    };
    const candidates = blocks.filter((block) => {
      if (used.has(block.index)) return false;
      if (!block.box) return false;
      if (normalize(block.text)) return false;
      const center = boxCenter(block.box);
      if (!center) return false;

      // Cycle/Radial arrow decorations are small, textless shapes between two item anchors.
      // Node icons are also textless, but in the current templates they are larger and centered on the node.
      const isSmallDecoration = block.box.cx <= 480000 && block.box.cy <= 480000;
      const nearMidpoint = Math.abs(center.x - midpoint.x) <= 460000 && Math.abs(center.y - midpoint.y) <= 700000;
      return isSmallDecoration && nearMidpoint;
    });
    const boxes = candidates.map((block) => block.box).filter((box): box is Box => Boolean(box));
    if (!boxes.length) continue;
    for (const block of candidates) used.add(block.index);
    groups.push({
      index,
      box: unionBoxes(boxes),
      blocks: candidates.sort((a, b) => a.index - b.index),
    });
  }

  return groups;
}

function inferCycleCircleBlocks(blocks: XmlBlock[], count: number): XmlBlock[] {
  return blocks
    .filter((block) => {
      if (!block.box) return false;
      if (normalize(block.text)) return false;
      const minSide = Math.min(block.box.cx, block.box.cy);
      const maxSide = Math.max(block.box.cx, block.box.cy);
      return minSide >= 900000 && safeDiv(minSide, maxSide) >= 0.82;
    })
    .sort((a, b) => (a.box?.x ?? 0) - (b.box?.x ?? 0))
    .slice(0, count);
}

function inferCycleNodeGroups(blocks: XmlBlock[], circleBlocks: XmlBlock[]): ItemGroup[] {
  const circles = circleBlocks
    .map((block) => block.box)
    .filter((box): box is Box => Boolean(box));
  const centers = circles
    .map((box) => boxCenter(box))
    .filter((center): center is { x: number; y: number } => Boolean(center));
  if (!circles.length || !centers.length) return [];

  const region = expandBox(unionBoxes(circles), 0.16);
  const bands = computeAxisBands(centers, region, "x");
  const assigned = new Map<number, XmlBlock[]>();

  for (const block of blocks) {
    if (!block.box) continue;
    const center = boxCenter(block.box);
    if (!center) continue;
    if (!boxIntersects(region, block.box) && !pointInBox(region, center)) continue;

    const nearest = nearestCenterIndexInBand(center, centers, bands, "row");
    if (nearest < 0) continue;
    const circle = circles[nearest];
    const circleRegion = expandBox(circle, 0.24);
    if (!boxIntersects(circleRegion, block.box) && !pointInBox(circleRegion, center)) continue;

    const group = assigned.get(nearest) ?? [];
    group.push(block);
    assigned.set(nearest, group);
  }

  return circles
    .map((circle, index) => {
      const groupBlocks = assigned.get(index) ?? [];
      const boxes = groupBlocks.map((block) => block.box).filter((box): box is Box => Boolean(box));
      if (!groupBlocks.length || !boxes.length) return undefined;
      return { index, box: unionBoxes(boxes), blocks: groupBlocks.sort((a, b) => a.index - b.index) };
    })
    .filter((group): group is ItemGroup => Boolean(group));
}

function inferLayoutKind(groups: ItemGroup[], list: ListManifest): LayoutKind {
  return inferLayoutKindFromBoxes(groups.map((group) => group.box), list);
}

function inferLayoutKindFromBoxes(boxes: Box[], list: ListManifest): LayoutKind {
  if (isTimelineList(list)) return "timeline";
  const centers = boxes.map((box) => boxCenter(box)).filter((point): point is { x: number; y: number } => Boolean(point));
  const xs = centers.map((point) => point.x);
  const ys = centers.map((point) => point.y);
  const xRange = Math.max(...xs) - Math.min(...xs);
  const yRange = Math.max(...ys) - Math.min(...ys);
  const avgW = average(boxes.map((box) => box.cx));
  const avgH = average(boxes.map((box) => box.cy));
  if (xRange > avgW && yRange > avgH) return "grid";
  if (xRange >= yRange) return "row";
  return "column";
}

interface AssignmentBand {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

function computeAssignmentBands(
  centers: Array<{ x: number; y: number } | undefined>,
  region: Box,
  kind: LayoutKind,
): AssignmentBand[] {
  if (kind === "column") return computeAxisBands(centers, region, "y");
  if (kind === "grid") return centers.map((center) => ({
    minX: center ? center.x - region.cx * 0.2 : region.x,
    maxX: center ? center.x + region.cx * 0.2 : region.x + region.cx,
    minY: center ? center.y - region.cy * 0.2 : region.y,
    maxY: center ? center.y + region.cy * 0.2 : region.y + region.cy,
  }));
  return computeAxisBands(centers, region, "x");
}

function computeAxisBands(
  centers: Array<{ x: number; y: number } | undefined>,
  region: Box,
  axis: "x" | "y",
): AssignmentBand[] {
  return centers.map((center, index) => {
    const previous = centers[index - 1];
    const next = centers[index + 1];
    const min = previous && center ? (previous[axis] + center[axis]) / 2 : region[axis];
    const max = next && center ? (next[axis] + center[axis]) / 2 : region[axis] + (axis === "x" ? region.cx : region.cy);
    return axis === "x"
      ? { minX: min, maxX: max, minY: region.y, maxY: region.y + region.cy }
      : { minX: region.x, maxX: region.x + region.cx, minY: min, maxY: max };
  });
}

function computeSlots(region: Box, groups: ItemGroup[], count: number, kind: LayoutKind): Box[] {
  if (count <= 0) return [];
  if (kind === "column") return computeColumnSlots(region, count);
  if (kind === "grid") return computeGridSlots(region, count);
  if (kind === "timeline") return computeTimelineSlots(region, groups, count);
  return computeRowSlots(region, count);
}

function computeReductionSlots(groups: ItemGroup[], count: number, kind: LayoutKind): Box[] {
  if (count <= 0) return [];
  if (kind === "timeline" || kind === "column" || kind === "grid") {
    return groups.slice(0, count).map((group) => group.box);
  }

  const indexes = evenlyPickIndexes(groups.length, count);
  return indexes.map((index) => groups[index]?.box).filter((box): box is Box => Boolean(box));
}

function evenlyPickIndexes(total: number, count: number): number[] {
  if (count <= 0) return [];
  if (count >= total) return Array.from({ length: total }, (_, index) => index);
  if (count === 1) return [Math.floor((total - 1) / 2)];
  return Array.from({ length: count }, (_, index) => Math.round((index * (total - 1)) / (count - 1)));
}

function computeRowSlots(region: Box, count: number): Box[] {
  const gap = Math.min(region.cx * GAP_RATIO, 240000);
  const width = (region.cx - gap * (count - 1)) / count;
  return Array.from({ length: count }, (_, index) => ({
    x: Math.round(region.x + index * (width + gap)),
    y: region.y,
    cx: Math.round(width),
    cy: region.cy,
  }));
}

function computeColumnSlots(region: Box, count: number): Box[] {
  const gap = Math.min(region.cy * GAP_RATIO, 180000);
  const height = (region.cy - gap * (count - 1)) / count;
  return Array.from({ length: count }, (_, index) => ({
    x: region.x,
    y: Math.round(region.y + index * (height + gap)),
    cx: region.cx,
    cy: Math.round(height),
  }));
}

function computeGridSlots(region: Box, count: number): Box[] {
  const cols = count <= 2 ? count : count <= 4 ? 2 : 3;
  const rows = Math.ceil(count / cols);
  const gapX = Math.min(region.cx * 0.045, 180000);
  const gapY = Math.min(region.cy * 0.075, 160000);
  const width = (region.cx - gapX * (cols - 1)) / cols;
  const height = (region.cy - gapY * (rows - 1)) / rows;
  return Array.from({ length: count }, (_, index) => {
    const row = Math.floor(index / cols);
    const col = index % cols;
    const rowCount = row === rows - 1 ? count - row * cols : cols;
    const rowOffset = rowCount < cols ? ((cols - rowCount) * (width + gapX)) / 2 : 0;
    return {
      x: Math.round(region.x + rowOffset + col * (width + gapX)),
      y: Math.round(region.y + row * (height + gapY)),
      cx: Math.round(width),
      cy: Math.round(height),
    };
  });
}

function computeTimelineSlots(region: Box, groups: ItemGroup[], count: number): Box[] {
  const source = groups.map((group) => group.box);
  const avgW = average(source.map((box) => box.cx));
  const width = Math.min(avgW, region.cx / Math.max(count, 1));
  const step = count === 1 ? 0 : (region.cx - width) / (count - 1);
  return Array.from({ length: count }, (_, index) => ({
    x: Math.round(region.x + index * step),
    y: source[index % source.length]?.y ?? region.y,
    cx: Math.round(width),
    cy: source[index % source.length]?.cy ?? region.cy,
  }));
}

function computeGlobalFitScale(groups: ItemGroup[], slots: Box[], count: number): number {
  let scale = 1;
  for (let index = 0; index < count; index += 1) {
    const group = groups[Math.min(index, groups.length - 1)] ?? groups[0];
    const slot = slots[index];
    if (!group || !slot) continue;
    scale = Math.min(scale, fitScale(group.box, slot));
  }
  return scale;
}

function fitScale(sourceBox: Box, slot: Box): number {
  return Math.min(1, safeDiv(slot.cx, sourceBox.cx), safeDiv(slot.cy, sourceBox.cy));
}

function appendGeneratedBlocksToTop(slideXml: string, generatedXml: string): string {
  if (!generatedXml) return slideXml;
  return slideXml.replace("</p:spTree>", `${generatedXml}</p:spTree>`);
}

function moveBlockToSlot(blockXml: string, sourceBox: Box, slot: Box, scale: number): string {
  const targetBox = {
    x: slot.x + (slot.cx - sourceBox.cx * scale) / 2,
    y: slot.y + (slot.cy - sourceBox.cy * scale) / 2,
  };
  return blockXml.replace(/<a:off[^>]*\bx="(-?\d+)"[^>]*\by="(-?\d+)"[^>]*\/><a:ext[^>]*\bcx="(-?\d+)"[^>]*\bcy="(-?\d+)"[^>]*\/>/g, (xfrm, xText, yText, cxText, cyText) => {
    const x = Number(xText);
    const y = Number(yText);
    const cx = Number(cxText);
    const cy = Number(cyText);
    const next = {
      x: Math.round(targetBox.x + (x - sourceBox.x) * scale),
      y: Math.round(targetBox.y + (y - sourceBox.y) * scale),
      cx: Math.round(cx * scale),
      cy: Math.round(cy * scale),
    };
    return xfrm
      .replace(/\bx="-?\d+"/, `x="${next.x}"`)
      .replace(/\by="-?\d+"/, `y="${next.y}"`)
      .replace(/\bcx="-?\d+"/, `cx="${next.cx}"`)
      .replace(/\bcy="-?\d+"/, `cy="${next.cy}"`);
  });
}

function assignNewShapeIdentity(blockXml: string, nextId: () => number): string {
  return blockXml.replace(/<p:cNvPr\b([^>]*)\bid="[^"]+"([^>]*)>/, (match, before, after) => {
    const id = nextId();
    let tag = `<p:cNvPr${before}id="${id}"${after}>`;
    tag = tag.replace(/\bname="([^"]*)"/, (_nameMatch, name) => `name="${xmlEscape(`${name} dsl ${id}`)}"`);
    return tag;
  });
}

function replaceListItemTexts(blockXml: string, list: ListManifest, item: Record<string, string | number>): string {
  let xml = blockXml;
  for (const field of list.itemFields) {
    const value = item[field.key];
    if (value === undefined) continue;
    if (normalize(textFromATags(xml)).includes(normalize(field.key))) {
      xml = setFirstTextRun(xml, String(value));
    }
  }
  return xml;
}

function replaceImplicitNumberText(blockXml: string, itemIndex: number): string {
  const text = normalize(textFromATags(blockXml));
  if (!/^\d{1,2}$/.test(text)) return blockXml;
  return setFirstTextRun(blockXml, String(itemIndex + 1).padStart(2, "0"));
}

function isTimelineGlobalBlock(block: XmlBlock, region: Box, count: number): boolean {
  if (!block.box) return false;
  const maxItemWidth = region.cx / Math.max(count, 1);
  return block.box.cx > maxItemWidth * 1.45 || block.box.cy > region.cy * 0.9;
}

function setFirstTextRun(blockXml: string, value: string): string {
  let wrote = false;
  return blockXml.replace(/<a:t>[\s\S]*?<\/a:t>/g, () => {
    if (wrote) return "<a:t></a:t>";
    wrote = true;
    return `<a:t>${xmlEscape(value)}</a:t>`;
  });
}

function replaceBlockTextByShapeIndex(slideXml: string, shapeIndex: number, value: string): string {
  let index = 0;
  return slideXml.replace(/<p:sp\b[\s\S]*?<\/p:sp>/g, (block) => {
    if (index++ !== shapeIndex) return block;
    return setFirstTextRun(block, value);
  });
}

function readBox(xml: string): Box | undefined {
  const match = xml.match(/<a:off[^>]*\bx="(-?\d+)"[^>]*\by="(-?\d+)"[^>]*\/><a:ext[^>]*\bcx="(-?\d+)"[^>]*\bcy="(-?\d+)"/);
  if (!match) return undefined;
  return { x: Number(match[1]), y: Number(match[2]), cx: Number(match[3]), cy: Number(match[4]) };
}

function optionalBox(value: { x?: number; y?: number; cx?: number; cy?: number }): Box | undefined {
  if ([value.x, value.y, value.cx, value.cy].some((part) => part === undefined)) return undefined;
  return { x: value.x!, y: value.y!, cx: value.cx!, cy: value.cy! };
}

function unionBoxes(boxes: Box[]): Box {
  const x1 = Math.min(...boxes.map((box) => box.x));
  const y1 = Math.min(...boxes.map((box) => box.y));
  const x2 = Math.max(...boxes.map((box) => box.x + box.cx));
  const y2 = Math.max(...boxes.map((box) => box.y + box.cy));
  return { x: x1, y: y1, cx: x2 - x1, cy: y2 - y1 };
}

function expandBox(box: Box, ratio: number): Box {
  const dx = box.cx * ratio;
  const dy = box.cy * ratio;
  return { x: box.x - dx, y: box.y - dy, cx: box.cx + dx * 2, cy: box.cy + dy * 2 };
}

function boxCenter(box?: Box): { x: number; y: number } | undefined {
  if (!box) return undefined;
  return { x: box.x + box.cx / 2, y: box.y + box.cy / 2 };
}

function nearestCenterIndex(point: { x: number; y: number } | undefined, centers: Array<{ x: number; y: number } | undefined>): number {
  if (!point) return -1;
  let best = -1;
  let bestDistance = Infinity;
  centers.forEach((center, index) => {
    if (!center) return;
    const distance = pointDistance(point, center);
    if (distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  });
  return best;
}

function nearestCenterIndexInBand(
  point: { x: number; y: number } | undefined,
  centers: Array<{ x: number; y: number } | undefined>,
  bands: AssignmentBand[],
  kind: LayoutKind,
): number {
  if (!point) return -1;
  const candidates = centers
    .map((center, index) => ({ center, index, band: bands[index] }))
    .filter(({ center, band }) => {
      if (!center || !band) return false;
      return point.x >= band.minX && point.x <= band.maxX && point.y >= band.minY && point.y <= band.maxY;
    });

  if (!candidates.length) return nearestCenterIndex(point, centers);
  let best = -1;
  let bestDistance = Infinity;
  for (const { center, index } of candidates) {
    if (!center) continue;
    const distance = kind === "column" ? Math.abs(point.y - center.y) : kind === "grid" ? pointDistance(point, center) : Math.abs(point.x - center.x);
    if (distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  }
  return best;
}

function pointDistance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function pointInBox(box: Box, point?: { x: number; y: number }): boolean {
  if (!point) return false;
  return point.x >= box.x && point.x <= box.x + box.cx && point.y >= box.y && point.y <= box.y + box.cy;
}

function boxIntersects(a: Box, b: Box): boolean {
  return a.x <= b.x + b.cx && a.x + a.cx >= b.x && a.y <= b.y + b.cy && a.y + a.cy >= b.y;
}

function safeDiv(a: number, b: number): number {
  return b === 0 ? 1 : a / b;
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
}

function normalize(value: string): string {
  return value.replace(/\s+/g, "");
}

function maxShapeId(slideXml: string): number {
  return Math.max(0, ...[...slideXml.matchAll(/<p:cNvPr[^>]*\bid="(\d+)"/g)].map((match) => Number(match[1])));
}
