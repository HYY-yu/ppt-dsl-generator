export function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function xmlUnescape(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

export function textFromATags(xml: string): string {
  return [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)]
    .map((match) => xmlUnescape(match[1]))
    .join("");
}

export function allTextRuns(xml: string): string[] {
  return [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((match) => xmlUnescape(match[1]));
}

export function replaceShapeText(slideXml: string, shapeIndex: number, value: string): string {
  let index = 0;
  return slideXml.replace(/<p:sp\b[\s\S]*?<\/p:sp>/g, (shapeXml) => {
    if (index++ !== shapeIndex) return shapeXml;
    let wroteFirst = false;
    return shapeXml.replace(/<a:t>([\s\S]*?)<\/a:t>/g, () => {
      if (!wroteFirst) {
        wroteFirst = true;
        return `<a:t>${xmlEscape(value)}</a:t>`;
      }
      return "<a:t></a:t>";
    });
  });
}

export function readXfrm(blockXml: string): { x?: number; y?: number; cx?: number; cy?: number } {
  const off = blockXml.match(/<a:off[^>]*\bx="(-?\d+)"[^>]*\by="(-?\d+)"/);
  const ext = blockXml.match(/<a:ext[^>]*\bcx="(-?\d+)"[^>]*\bcy="(-?\d+)"/);
  return {
    x: off ? Number(off[1]) : undefined,
    y: off ? Number(off[2]) : undefined,
    cx: ext ? Number(ext[1]) : undefined,
    cy: ext ? Number(ext[2]) : undefined,
  };
}
