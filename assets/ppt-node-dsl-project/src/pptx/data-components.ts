import JSZip from "jszip";
import type { ComponentManifest, TableValue, ChartValue, Palette } from "../types.js";
import { parseRelationships, relationshipPartForOwner, resolveRelationshipTarget } from "./relationships.js";
import { readZipText } from "./read.js";
import { replaceNodeRaw, type XmlNode } from "./nodes.js";

const esc = (v: string | number) => String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
const matches = (xml: string, re: RegExp) => [...xml.matchAll(re)].map(m => m[0]);
const object = (properties: Record<string, unknown>) => ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties });
const array = (items: unknown, minItems: number, maxItems: number) => ({ type: "array", items, minItems, maxItems });
const color = { type: "string", pattern: "^#[a-fA-F0-9]{6}$" };
export const paletteSchema = object({ primary: color, onPrimary: color, secondary: color, background: color, surface: color, text: color, mutedText: color, border: color, chart: array(color, 3, 12) });
export function validatePalette(p: Palette): string[] {
  if (!p || typeof p !== "object" || Array.isArray(p)) return ["palette 必须是配色对象"];
  if (Object.keys(p).some(k => !["primary", "onPrimary", "secondary", "background", "surface", "text", "mutedText", "border", "chart"].includes(k))) return ["palette 存在额外字段"];
  const colors = [p.primary, p.onPrimary, p.secondary, p.background, p.surface, p.text, p.mutedText, p.border, ...(Array.isArray(p.chart) ? p.chart : [])];
  return colors.some(v => typeof v !== "string" || !/^#[a-f\d]{6}$/i.test(v)) || !Array.isArray(p.chart) || p.chart.length < 3 || p.chart.length > 12 ? ["palette 必须包含有效 HEX 颜色和 3-12 个图表颜色"] : [];
}

async function linkedPart(zip: JSZip, owner: string, id: string): Promise<string> {
  const rel = parseRelationships(await readZipText(zip, relationshipPartForOwner(owner))).find(r => r.id === id);
  if (!rel || rel.targetMode === "External") throw new Error(`缺少内部 relationship ${owner}:${id}`);
  return resolveRelationshipTarget(owner, rel.target);
}
export async function inspectDataComponent(zip: JSZip, slidePath: string, node: XmlNode, kind: "table" | "chart"): Promise<Partial<ComponentManifest>> {
  if (node.type !== "graphicFrame") throw new Error(`${kind} 必须标记原生 graphicFrame`);
  if (kind === "table") {
    const rows = matches(node.raw, /<a:tr\b[\s\S]*?<\/a:tr>/g);
    const columns = matches(node.raw, /<a:gridCol\b[^>]*>/g).length;
    if (rows.length < 2 || columns < 1 || /\b(?:gridSpan|rowSpan|hMerge|vMerge)=/.test(node.raw)) throw new Error("表格必须包含表头和数据行，暂不支持合并单元格");
    return { table: { columns, minRows: 1, maxRows: rows.length - 1, maxTextLength: 24 } };
  }
  const id = node.raw.match(/<c:chart\b[^>]*r:id="([^"]+)"/)?.[1];
  if (!id) throw new Error("图表缺少 c:chart relationship");
  const chartPath = await linkedPart(zip, slidePath, id);
  const xml = await readZipText(zip, chartPath);
  const types = [...xml.matchAll(/<c:(\w+)Chart\b/g)].map(m => m[1]);
  if (types.length !== 1 || !["bar", "line", "doughnut"].includes(types[0])) throw new Error(`暂不支持图表类型 ${types.join(",")}`);
  const series = matches(xml, /<c:ser\b[\s\S]*?<\/c:ser>/g);
  const counts = series.map(s => Number(s.match(/<c:cat>[\s\S]*?<c:ptCount val="(\d+)"/)?.[1]));
  if (!series.length || counts.some(v => !v || v !== counts[0])) throw new Error("图表分类缓存不完整或系列分类不一致");
  const external = xml.match(/<c:externalData\b[^>]*r:id="([^"]+)"/)?.[1];
  if (!external) throw new Error("图表必须包含可编辑的内嵌工作簿");
  await linkedPart(zip, chartPath, external);
  return { chart: { type: types[0] as "bar" | "line" | "doughnut", series: series.length, minCategories: 1, maxCategories: counts[0], maxTextLength: 24 } };
}
export function dataValueSchema(c: ComponentManifest): Record<string, unknown> {
  const limit = c.table?.maxTextLength ?? c.chart?.maxTextLength ?? 24;
  const text = { type: "string", minLength: 1, maxLength: limit };
  if (c.kind === "table" && c.table) return object({ headers: array(text, c.table.columns, c.table.columns), rows: array(array(text, c.table.columns, c.table.columns), c.table.minRows, c.table.maxRows) });
  if (c.kind === "chart" && c.chart) return object({ categories: array(text, c.chart.minCategories, c.chart.maxCategories), series: array(object({ name: text, values: array({ type: "number", ...(c.chart.type === "doughnut" ? { minimum: 0 } : {}) }, c.chart.minCategories, c.chart.maxCategories) }), c.chart.series, c.chart.series) });
  throw new Error(`${c.key} 缺少数据合同`);
}
export function validateDataValue(c: ComponentManifest, value: unknown): string[] {
  const errors: string[] = [];
  const v = value as TableValue & ChartValue;
  if (!v || typeof v !== "object" || Array.isArray(v)) return ["必须是数据对象"];
  const validText = (x: unknown) => typeof x === "string" && x.trim().length > 0 && Array.from(x).length <= (c.table?.maxTextLength ?? c.chart?.maxTextLength ?? 24) && !/\p{Cf}/u.test(x);
  if (c.kind === "table") {
    const t = c.table;
    if (!t) return ["缺少 table 合同"];
    if (Object.keys(v).some(k => !["headers", "rows"].includes(k))) errors.push("表格存在额外字段");
    if (!Array.isArray(v.headers) || v.headers.length !== t.columns || !v.headers.every(validText)) errors.push(`表头必须是 ${t.columns} 个有效短文本`);
    if (!Array.isArray(v.rows) || v.rows.length < t.minRows || v.rows.length > t.maxRows || v.rows.some(r => !Array.isArray(r) || r.length !== t.columns || !r.every(validText))) errors.push(`数据必须是 ${t.minRows}-${t.maxRows} 行、${t.columns} 列有效短文本`);
  } else {
    const t = c.chart;
    if (!t) return ["缺少 chart 合同"];
    if (Object.keys(v).some(k => !["categories", "series"].includes(k))) errors.push("图表存在额外字段");
    if (!Array.isArray(v.categories) || v.categories.length < t.minCategories || v.categories.length > t.maxCategories || !v.categories.every(validText) || new Set(v.categories).size !== v.categories.length) errors.push(`分类必须是 ${t.minCategories}-${t.maxCategories} 个不重复有效短文本`);
    if (!Array.isArray(v.series) || v.series.length !== t.series || v.series.some(s => !s || Object.keys(s).some(k => !["name", "values"].includes(k)) || !validText(s.name) || !Array.isArray(s.values) || s.values.length !== v.categories?.length || s.values.some(n => typeof n !== "number" || !Number.isFinite(n) || (t.type === "doughnut" && n < 0)) || (t.type === "doughnut" && s.values.every(n => n === 0)))) errors.push(`必须包含 ${t.series} 个系列，数值长度与分类一致；圆环值非负且总和大于零`);
  }
  return errors;
}

export async function patchDataComponent(zip: JSZip, slidePath: string, xml: string, node: XmlNode, c: ComponentManifest, value: unknown): Promise<string> {
  const errors = validateDataValue(c, value);
  if (errors.length) throw new Error(`${slidePath}:${node.id} ${errors.join("; ")}`);
  if (c.kind === "table") {
    const v = value as TableValue;
    const rows = matches(node.raw, /<a:tr\b[\s\S]*?<\/a:tr>/g);
    const data = [v.headers, ...v.rows];
    const totalHeight = rows.reduce((s, r) => s + Number(r.match(/\bh="(\d+)"/)?.[1] ?? 0), 0);
    const headerHeight = Number(rows[0].match(/\bh="(\d+)"/)?.[1] ?? 0);
    const filled = data.map((cells, rowIndex) => {
      let col = 0;
      return rows[rowIndex].replace(/\bh="\d+"/, `h="${rowIndex === 0 ? headerHeight : Math.round((totalHeight - headerHeight) / v.rows.length)}"`).replace(/<a:tc\b[\s\S]*?<\/a:tc>/g, cell => {
        const text = cells[col++];
        if (!/<a:t>/.test(cell)) {
          const run = `<a:r><a:rPr/><a:t>${esc(text)}</a:t></a:r>`;
          return cell.replace(/<a:p\s*\/>/, `<a:p>${run}</a:p>`).replace(/(<a:p(?:\s[^>]*)?>)([\s\S]*?)(<\/a:p>)/, (all, open, content, close) => content.includes("<a:t>") ? all : `${open}${content.includes("<a:endParaRPr") ? content.replace("<a:endParaRPr", `${run}<a:endParaRPr`) : content + run}${close}`);
        }
        let first = true;
        return cell.replace(/<a:t>[\s\S]*?<\/a:t>/g, () => { const t = first ? esc(text) : ""; first = false; return `<a:t>${t}</a:t>`; });
      });
    }).join("");
    let inserted = false;
    const raw = node.raw.replace(/<a:tr\b[\s\S]*?<\/a:tr>/g, () => { if (inserted) return ""; inserted = true; return filled; });
    console.info(`[generate:table] slide=${slidePath} shape=${node.id} rows=${v.rows.length} columns=${v.headers.length}`);
    return replaceNodeRaw(xml, node, raw);
  }
  const v = value as ChartValue;
  const relId = node.raw.match(/<c:chart\b[^>]*r:id="([^"]+)"/)?.[1];
  if (!relId) throw new Error("输出图表缺少 relationship");
  const oldPath = await linkedPart(zip, slidePath, relId);
  // Copy-on-write: reused template slides must never share mutable chart/workbook data.
  const unique = `${slidePath.match(/slide(\d+)\.xml/)?.[1]}-${node.id}`;
  const chartPath = `ppt/charts/dsl-${unique}.xml`;
  let chart = await readZipText(zip, oldPath);
  let rels = await readZipText(zip, relationshipPartForOwner(oldPath));
  const externalId = chart.match(/<c:externalData\b[^>]*r:id="([^"]+)"/)?.[1];
  if (!externalId) throw new Error("输出图表缺少内嵌工作簿");
  const oldWorkbook = await linkedPart(zip, oldPath, externalId);
  const workbookPath = `ppt/embeddings/dsl-${unique}.xlsx`;
  const workbookFile = zip.file(oldWorkbook);
  if (!workbookFile) throw new Error(`缺少工作簿 ${oldWorkbook}`);
  const book = await JSZip.loadAsync(await workbookFile.async("nodebuffer"));
  const wb = await readZipText(book, "xl/workbook.xml");
  const sheet = wb.match(/<sheet\b[^>]*\bname="([^"]+)"[^>]*\br:id="([^"]+)"/);
  if (!sheet) throw new Error("工作簿缺少数据工作表");
  const sheetPath = await linkedPart(book, "xl/workbook.xml", sheet[2]);
  const sheetName = sheet[1].replace(/&apos;/g, "'").replace(/&amp;/g, "&").replace(/'/g, "''");
  const range = (column: string) => esc(`'${sheetName}'!$${column}$2:$${column}$${v.categories.length + 1}`);
  let index = 0;
  chart = chart.replace(/<c:ser\b[\s\S]*?<\/c:ser>/g, series => {
    const i = index++, data = v.series[i], column = String.fromCharCode(66 + i);
    const points = (values: (string | number)[]) => `<c:ptCount val="${values.length}"/>` + values.map((x, j) => `<c:pt idx="${j}"><c:v>${esc(x)}</c:v></c:pt>`).join("");
    series = series.replace(/<c:tx>[\s\S]*?<\/c:tx>/, `<c:tx><c:strRef><c:f>${esc(`'${sheetName}'!$${column}$1`)}</c:f><c:strCache>${points([data.name])}</c:strCache></c:strRef></c:tx>`);
    series = series.replace(/<c:cat>[\s\S]*?<\/c:cat>/, `<c:cat><c:strRef><c:f>${range("A")}</c:f><c:strCache>${points(v.categories)}</c:strCache></c:strRef></c:cat>`);
    series = series.replace(/<c:val>[\s\S]*?<\/c:val>/, `<c:val><c:numRef><c:f>${range(column)}</c:f><c:numCache><c:formatCode>General</c:formatCode>${points(data.values)}</c:numCache></c:numRef></c:val>`);
    return series.replace(/<c:dPt>[\s\S]*?<\/c:dPt>/g, p => Number(p.match(/<c:idx val="(\d+)"/)?.[1]) >= v.categories.length ? "" : p);
  });
  const rows: (string | number)[][] = [["", ...v.series.map(s => s.name)], ...v.categories.map((x, i) => [x, ...v.series.map(s => s.values[i])])];
  const sheetData = `<sheetData>${rows.map((r, i) => `<row r="${i + 1}">${r.map((x, j) => { const ref = `${String.fromCharCode(65 + j)}${i + 1}`; return typeof x === "number" ? `<c r="${ref}"><v>${x}</v></c>` : `<c r="${ref}" t="inlineStr"><is><t>${esc(x)}</t></is></c>`; }).join("")}</row>`).join("")}</sheetData>`;
  const endCell = `${String.fromCharCode(65 + v.series.length)}${rows.length}`;
  let sheetXml = (await readZipText(book, sheetPath)).replace(/<sheetData\b[^>]*>[\s\S]*?<\/sheetData>/, sheetData).replace(/<dimension\b[^>]*\/>/, `<dimension ref="A1:${endCell}"/>`);
  // Keep workbook formatting and remove stale table/filter ranges if present.
  sheetXml = sheetXml.replace(/<autoFilter\b[^>]*\/>/g, `<autoFilter ref="A1:${endCell}"/>`);
  book.file(sheetPath, sheetXml);
  for (const name of Object.keys(book.files).filter(n => /^xl\/tables\/.*\.xml$/.test(n))) {
    book.file(name, (await readZipText(book, name)).replace(/\bref="[^"]+"/g, `ref="A1:${endCell}"`));
  }
  zip.file(workbookPath, await book.generateAsync({ type: "nodebuffer" }));
  rels = rels.replace(/<Relationship\b[^>]*\/?\s*>/g, r => r.includes(`Id="${externalId}"`) ? r.replace(/Target="[^"]+"/, `Target="../embeddings/dsl-${unique}.xlsx"`) : r);
  zip.file(chartPath, chart);
  zip.file(relationshipPartForOwner(chartPath), rels);
  const slideRels = relationshipPartForOwner(slidePath);
  zip.file(slideRels, (await readZipText(zip, slideRels)).replace(/<Relationship\b[^>]*\/?\s*>/g, r => r.includes(`Id="${relId}"`) ? r.replace(/Target="[^"]+"/, `Target="../charts/dsl-${unique}.xml"`) : r));
  const contentTypes = await readZipText(zip, "[Content_Types].xml");
  zip.file("[Content_Types].xml", contentTypes.replace("</Types>", `<Override PartName="/${chartPath}" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/></Types>`));
  console.info(`[generate:chart] slide=${slidePath} shape=${node.id} type=${c.chart?.type} categories=${v.categories.length} series=${v.series.length}`);
  return xml;
}

export async function applyPalette(zip: JSZip, p: Palette): Promise<void> {
  const errors = validatePalette(p);
  if (errors.length) throw new Error(errors.join("; "));
  const hex = (s: string) => s.slice(1).toUpperCase();
  const theme: Record<string, string> = { dk1: p.text, lt1: p.background, dk2: p.mutedText, lt2: p.surface, accent1: p.primary, accent2: p.secondary, accent3: p.border, accent4: p.chart[0], accent5: p.chart[1], accent6: p.chart[2], hlink: p.primary, folHlink: p.secondary };
  for (const name of Object.keys(zip.files).filter(n => /^ppt\/theme\/.*\.xml$/.test(n))) {
    let xml = await readZipText(zip, name);
    for (const [key, value] of Object.entries(theme)) xml = xml.replace(new RegExp(`<a:${key}>[\\s\\S]*?</a:${key}>`, "g"), `<a:${key}><a:srgbClr val="${hex(value)}"/></a:${key}>`);
    zip.file(name, xml);
  }
  // Light text is the inverse foreground, not the page background color.
  for (const name of Object.keys(zip.files).filter(n => /^ppt\/(slides|slideLayouts|slideMasters)\/[^/]+\.xml$/.test(n))) {
    const xml = await readZipText(zip, name);
    zip.file(name, xml.replace(/<a:(?:rPr|defRPr)\b[^>]*>[\s\S]*?<\/a:(?:rPr|defRPr)>/g, run => run.replace(/<a:schemeClr val="lt1"\s*\/>/g, `<a:srgbClr val="${hex(p.onPrimary)}"/>`)));
  }
  for (const name of Object.keys(zip.files).filter(n => /^ppt\/charts\/.*\.xml$/.test(n) && !n.includes("_rels"))) {
    let xml = await readZipText(zip, name);
    let seriesIndex = 0;
    const doughnut = xml.includes("<c:doughnutChart");
    xml = xml.replace(/<c:ser\b[\s\S]*?<\/c:ser>/g, s => {
      const col = hex(p.chart[seriesIndex++ % p.chart.length]);
      const pointParts: string[] = [];
      s = s.replace(/<c:dPt>[\s\S]*?<\/c:dPt>/g, point => { const index = pointParts.length; pointParts.push(point); return `__POINT_${index}__`; });
      s = s.replace(/<a:srgbClr val="[A-Fa-f\d]{6}"/g, `<a:srgbClr val="${col}"`);
      s = s.replace(/__POINT_(\d+)__/g, (_, i) => { const point = pointParts[Number(i)]; const idx = Number(point.match(/<c:idx val="(\d+)"/)?.[1] ?? i); return point.replace(/<a:(?:srgbClr|schemeClr) val="[^"]+"\s*\/>/g, `<a:srgbClr val="${hex(p.chart[idx % p.chart.length])}"/>`); });
      if (doughnut && !pointParts.length) {
        const count = Number(s.match(/<c:cat>[\s\S]*?<c:ptCount val="(\d+)"/)?.[1] ?? 0);
        s = s.replace(/<c:cat>/, Array.from({ length: count }, (_, i) => `<c:dPt><c:idx val="${i}"/><c:spPr><a:solidFill><a:srgbClr val="${hex(p.chart[i % p.chart.length])}"/></a:solidFill></c:spPr></c:dPt>`).join("") + "<c:cat>");
      }
      return s;
    });
    xml = xml.replace(/<a:srgbClr val="(?:666666|D4D4D4)"/g, m => `<a:srgbClr val="${hex(m.includes("666666") ? p.mutedText : p.border)}"`);
    zip.file(name, xml);
  }
  console.info(`[generate:palette] primary=${p.primary} chartColors=${p.chart.length}`);
}
