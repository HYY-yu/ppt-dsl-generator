export const MAX_MATCH_COMPONENTS = 8;

type MatchComponent = {
  sampleContent: string;
  length?: { min: number; max: number };
  imageIndex?: number;
  locator: { box?: { cx: number; cy: number } };
};

export function bestComponentAssignment<T extends MatchComponent>(
  contract: MatchComponent[],
  candidates: T[],
  maxComponents = MAX_MATCH_COMPONENTS,
): { assignment: T[]; ambiguous: boolean } {
  if (contract.length !== candidates.length) throw new Error("COMPONENT_MATCH_COUNT");
  if (candidates.length > maxComponents) {
    throw new Error(`COMPONENT_MATCH_LIMIT: at most ${maxComponents} same-kind components per list item`);
  }

  const cost = contract.map(source => candidates.map(candidate => {
    let score = 0;
    if (source.length) {
      const length = [...candidate.sampleContent.replace(/\s/g, "")].length;
      if (length < source.length.min || length > source.length.max) score += 1000;
    }
    const sourceBox = source.locator.box;
    const candidateBox = candidate.locator.box;
    if (sourceBox && candidateBox) {
      score += Math.abs(Math.log(Math.max(candidateBox.cx, 1) / Math.max(sourceBox.cx, 1)));
      score += Math.abs(Math.log(Math.max(candidateBox.cy, 1) / Math.max(sourceBox.cy, 1)));
    }
    if (source.imageIndex !== undefined && candidate.imageIndex !== undefined && source.imageIndex !== candidate.imageIndex) {
      score += 100;
    }
    return score;
  }));
  let best = [...candidates];
  let bestScore = Infinity;
  let bestCount = 0;
  const used = new Set<number>();
  const order: number[] = [];

  function visit(depth: number, score: number): void {
    if (depth === candidates.length) {
      if (score < bestScore - 1e-9) {
        best = order.map(index => candidates[index]);
        bestScore = score;
        bestCount = 1;
      } else if (Math.abs(score - bestScore) <= 1e-9) {
        bestCount++;
      }
      return;
    }
    for (let index = 0; index < candidates.length; index++) {
      if (used.has(index)) continue;
      used.add(index);
      order.push(index);
      visit(depth + 1, score + cost[depth][index]);
      order.pop();
      used.delete(index);
    }
  }

  visit(0, 0);
  return { assignment: best, ambiguous: candidates.length > 1 && bestCount > 1 };
}
