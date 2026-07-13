import type { LintResult, TemplateManifest } from "./types.js";

const REQUIRED_PAGE_TYPES = ["封面页", "目录页", "章节过渡页", "内容页", "结尾页"];

export function lintTemplate(manifest: TemplateManifest): LintResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  for (const slide of manifest.slides) {
    for (const message of slide.warnings) (message.startsWith("ERROR:") ? errors : warnings).push(message.replace(/^ERROR:\s*/, ""));
    const editable = slide.nodes.length + slide.lists.reduce((sum, list) => sum + list.items.flatMap((item) => item.components).length, 0);
    if (!editable) errors.push(`第 ${slide.slideNumber} 页没有可编辑 DSL 节点`);
    for (const node of slide.nodes) validateComponent(slide.slideNumber, node, errors);
    for (const list of slide.lists) {
      if (list.dynamic && !list.items.every((item) => item.groupLocator?.nodeType === "grpSp")) errors.push(`第 ${slide.slideNumber} 页变长列表 ${list.listIndex} 必须全部使用 Group`);
      if (list.items.length < list.minItems || list.items.length > list.maxItems) errors.push(`第 ${slide.slideNumber} 页列表 ${list.listIndex} 模板项数 ${list.items.length} 不在 [${list.minItems}-${list.maxItems}]`);
      list.items.flatMap((item) => item.components).forEach((component) => validateComponent(slide.slideNumber, component, errors));
    }
  }
  for (const type of REQUIRED_PAGE_TYPES) if (!manifest.slides.some((slide) => slide.pageType === type)) errors.push(`模板缺少页面类型: ${type}`);
  return { errors: [...new Set(errors)], warnings: [...new Set(warnings)] };
}

function validateComponent(slideNumber: number, component: { kind: string; key: string; locator: { shapeId: string }; length?: { min: number; max: number } }, errors: string[]): void {
  if (!component.locator.shapeId) errors.push(`第 ${slideNumber} 页 ${component.key} 缺少 shapeId`);
  if (component.kind === "text" && !component.length) errors.push(`第 ${slideNumber} 页 ${component.key} 文本缺少长度声明或可继承声明`);
  if (component.length && component.length.min > component.length.max) errors.push(`第 ${slideNumber} 页 ${component.key} 长度范围非法`);
}
