import type { Box } from "../types.js";

export interface DynamicListLayoutPlan {
  slots: Box[];
  sourceIndexes: number[];
  mode: "template" | "pattern" | "uniform";
  patternPeriod: number;
}

export function planDynamicListLayout(
  sourceBoxes: Box[],
  count: number,
  layout: "row" | "column",
): DynamicListLayoutPlan {
  if (count <= 0) return { slots: [], sourceIndexes: [], mode: "template", patternPeriod: 0 };
  if (!sourceBoxes.length) {
    const fallback = { x: 0, y: 0, cx: 1, cy: 1 };
    return {
      slots: layoutUniformSlots(fallback, fallback, count, layout),
      sourceIndexes: Array.from({ length: count }, () => 0),
      mode: "uniform",
      patternPeriod: 1,
    };
  }
  if (count === sourceBoxes.length) {
    return {
      slots: sourceBoxes.map((box) => ({ ...box })),
      sourceIndexes: sourceBoxes.map((_, index) => index),
      mode: "template",
      patternPeriod: detectCrossAxisPatternPeriod(sourceBoxes, layout),
    };
  }

  const region = unionBoxes(sourceBoxes);
  const period = detectCrossAxisPatternPeriod(sourceBoxes, layout);
  if (!hasCrossAxisVariation(sourceBoxes, layout)) {
    return {
      slots: layoutUniformSlots(region, sourceBoxes[0], count, layout),
      sourceIndexes: Array.from({ length: count }, (_, index) => index < sourceBoxes.length ? index : 0),
      mode: "uniform",
      patternPeriod: 1,
    };
  }

  const centers = sourceBoxes.map((box) => primaryCenter(box, layout));
  const start = Math.min(...centers);
  const end = Math.max(...centers);
  const sourceIndexes = Array.from({ length: count }, (_, index) => index < sourceBoxes.length ? index : index % period);
  const slots = sourceIndexes.map((sourceIndex, index) => {
    const prototype = sourceBoxes[sourceIndex];
    const center = count === 1 ? (start + end) / 2 : start + index * (end - start) / (count - 1);
    return layout === "row"
      ? { x: center - prototype.cx / 2, y: prototype.y, cx: prototype.cx, cy: prototype.cy }
      : { x: prototype.x, y: center - prototype.cy / 2, cx: prototype.cx, cy: prototype.cy };
  });
  return { slots, sourceIndexes, mode: "pattern", patternPeriod: period };
}

function layoutUniformSlots(region: Box, source: Box, count: number, layout: "row" | "column"): Box[] {
  if (layout === "row") {
    const slotWidth = region.cx / count;
    const scale = Math.min(1, slotWidth / source.cx);
    const cx = source.cx * scale;
    const cy = source.cy * scale;
    return Array.from({ length: count }, (_, index) => ({
      x: region.x + index * slotWidth + (slotWidth - cx) / 2,
      y: region.y + (region.cy - cy) / 2,
      cx,
      cy,
    }));
  }
  const slotHeight = region.cy / count;
  const scale = Math.min(1, slotHeight / source.cy);
  const cx = source.cx * scale;
  const cy = source.cy * scale;
  return Array.from({ length: count }, (_, index) => ({
    x: region.x + (region.cx - cx) / 2,
    y: region.y + index * slotHeight + (slotHeight - cy) / 2,
    cx,
    cy,
  }));
}

function hasCrossAxisVariation(boxes: Box[], layout: "row" | "column"): boolean {
  if (boxes.length < 2) return false;
  const centers = boxes.map((box) => crossCenter(box, layout));
  const sizes = boxes.map((box) => crossSize(box, layout));
  const tolerance = Math.max(1, Math.min(...sizes) * 0.01);
  return Math.max(...centers) - Math.min(...centers) > tolerance
    || Math.max(...sizes) - Math.min(...sizes) > tolerance;
}

function detectCrossAxisPatternPeriod(boxes: Box[], layout: "row" | "column"): number {
  if (!hasCrossAxisVariation(boxes, layout)) return 1;
  const sizes = boxes.map((box) => crossSize(box, layout));
  const tolerance = Math.max(1, Math.min(...sizes) * 0.01);
  for (let period = 1; period <= boxes.length; period += 1) {
    const matches = boxes.every((box, index) => index < period || sameCrossSignature(box, boxes[index % period], layout, tolerance));
    if (matches) return period;
  }
  return boxes.length;
}

function sameCrossSignature(a: Box, b: Box, layout: "row" | "column", tolerance: number): boolean {
  return Math.abs(crossCenter(a, layout) - crossCenter(b, layout)) <= tolerance
    && Math.abs(crossSize(a, layout) - crossSize(b, layout)) <= tolerance;
}

function primaryCenter(box: Box, layout: "row" | "column"): number {
  return layout === "row" ? box.x + box.cx / 2 : box.y + box.cy / 2;
}

function crossCenter(box: Box, layout: "row" | "column"): number {
  return layout === "row" ? box.y + box.cy / 2 : box.x + box.cx / 2;
}

function crossSize(box: Box, layout: "row" | "column"): number {
  return layout === "row" ? box.cy : box.cx;
}

function unionBoxes(boxes: Box[]): Box {
  const x = Math.min(...boxes.map((box) => box.x));
  const y = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.cx));
  const bottom = Math.max(...boxes.map((box) => box.y + box.cy));
  return { x, y, cx: right - x, cy: bottom - y };
}
