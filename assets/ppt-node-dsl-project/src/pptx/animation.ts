export function findDanglingAnimationShapeIds(slideXml: string): string[] {
  const shapeIds = new Set(
    Array.from(slideXml.matchAll(/<p:cNvPr\b[^>]*\bid="([^"]+)"/g), (match) => match[1]),
  );
  const targetIds = Array.from(
    slideXml.matchAll(/<(?:p:spTgt|p:bldP|p:bldGraphic)\b[^>]*\bspid="([^"]+)"/g),
    (match) => match[1],
  );
  return [...new Set(targetIds.filter((id) => !shapeIds.has(id)))];
}

export function removeTimingBlock(slideXml: string): string {
  return slideXml.replace(/<p:timing\b[\s\S]*?<\/p:timing>/g, "");
}

export interface AnimationRepairResult {
  xml: string;
  missingShapeIds: string[];
  prunedBranches: number;
  removedTimeline: boolean;
}

export function repairDanglingAnimationTimeline(slideXml: string): AnimationRepairResult {
  const missingShapeIds = findDanglingAnimationShapeIds(slideXml);
  if (!missingShapeIds.length) return { xml: slideXml, missingShapeIds, prunedBranches: 0, removedTimeline: false };
  const timingMatch = slideXml.match(/<p:timing\b[\s\S]*?<\/p:timing>/);
  if (!timingMatch) return { xml: slideXml, missingShapeIds, prunedBranches: 0, removedTimeline: false };
  const missing = new Set(missingShapeIds);
  const ranges = elementRanges(timingMatch[0], "p:par");
  const candidates = ranges.filter((range) => {
    const targetIds = animationTargetIds(timingMatch[0].slice(range.start, range.end));
    return targetIds.length > 0 && targetIds.every((id) => missing.has(id));
  });
  const outermost = candidates.filter((candidate) => !candidates.some((other) => (
    other !== candidate && other.start < candidate.start && other.end > candidate.end
  )));
  let timing = timingMatch[0];
  for (const range of [...outermost].sort((a, b) => b.start - a.start)) {
    timing = `${timing.slice(0, range.start)}${timing.slice(range.end)}`;
  }
  timing = timing.replace(/<p:(?:bldP|bldGraphic)\b[^>]*\bspid="([^"]+)"[^>]*\/>/g, (node, shapeId: string) => (
    missing.has(shapeId) ? "" : node
  ));
  let repaired = slideXml.replace(timingMatch[0], timing);
  const remainingMissing = findDanglingAnimationShapeIds(repaired);
  const hasAnimationTargets = /<(?:p:spTgt|p:bldP|p:bldGraphic)\b[^>]*\bspid="[^"]+"/.test(timing);
  if (remainingMissing.length || !hasAnimationTargets) {
    repaired = removeTimingBlock(repaired);
    return { xml: repaired, missingShapeIds, prunedBranches: outermost.length, removedTimeline: true };
  }
  return { xml: repaired, missingShapeIds, prunedBranches: outermost.length, removedTimeline: false };
}

interface ElementRange { start: number; end: number }

function elementRanges(xml: string, tagName: string): ElementRange[] {
  const escaped = tagName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const token = new RegExp(`<(/?)${escaped}\\b[^>]*>`, "g");
  const stack: number[] = [];
  const ranges: ElementRange[] = [];
  let match: RegExpExecArray | null;
  while ((match = token.exec(xml))) {
    if (match[1] !== "/") {
      if (!match[0].endsWith("/>")) stack.push(match.index);
      continue;
    }
    const start = stack.pop();
    if (start !== undefined) ranges.push({ start, end: token.lastIndex });
  }
  return ranges;
}

function animationTargetIds(xml: string): string[] {
  return [...new Set(Array.from(
    xml.matchAll(/<(?:p:spTgt|p:bldP|p:bldGraphic)\b[^>]*\bspid="([^"]+)"/g),
    (match) => match[1],
  ))];
}
