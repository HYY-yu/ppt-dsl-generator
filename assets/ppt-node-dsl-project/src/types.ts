export type PageType = "封面页" | "目录页" | "章节过渡页" | "内容页" | "结尾页";
export type ComponentKind = "text" | "image" | "icon" | "number" | "table" | "chart";

export interface LengthRange { min: number; max: number; fixed: boolean }
export interface Box { x: number; y: number; cx: number; cy: number }

export interface NodeLocator {
  shapeId: string;
  shapeName: string;
  nodeType: "sp" | "pic" | "grpSp" | "graphicFrame";
  path: number[];
  box?: Box;
  relId?: string;
  mediaTarget?: string;
}

export interface ComponentManifest {
  key: string;
  kind: ComponentKind;
  ordinal: number;
  rawDsl: string;
  sampleContent: string;
  length?: LengthRange;
  numberWidth?: number;
  imageIndex?: number;
  table?: TableContract;
  chart?: ChartContract;
  locator: NodeLocator;
}

export interface ListItemManifest {
  itemIndex: number;
  groupLocator?: NodeLocator;
  components: ComponentManifest[];
}

export interface ListManifest {
  key: string;
  listIndex: number;
  dynamic: boolean;
  minItems: number;
  maxItems: number;
  layout: "row" | "column";
  items: ListItemManifest[];
  componentContract: Array<Pick<ComponentManifest, "key" | "kind" | "ordinal" | "sampleContent" | "length" | "numberWidth" | "imageIndex">>;
}

export interface SlideManifest {
  templateId: string;
  slideNumber: number;
  slidePath: string;
  relId?: string;
  pageType: PageType;
  logic: string[];
  nodes: ComponentManifest[];
  lists: ListManifest[];
  warnings: string[];
}

export interface TemplateManifest {
  manifestVersion?: number;
  templateSha256?: string;
  sourceTemplate: string;
  generatedAt: string;
  slideCount: number;
  slides: SlideManifest[];
}

export type RichTextListStyle = "none" | "bullet" | "number";

export interface RichTextRunValue {
  text: string;
  bold: boolean;
  underline: boolean;
}

export interface RichTextParagraphValue {
  list: RichTextListStyle;
  runs: RichTextRunValue[];
}

export interface RichTextValue {
  paragraphs: RichTextParagraphValue[];
}

export interface AssetPathValue { path: string }

export type TextValue = string | RichTextValue;
export interface TableContract { columns: number; minRows: number; maxRows: number; maxTextLength: number }
export interface ChartContract { type: "bar" | "line" | "doughnut"; series: number; minCategories: number; maxCategories: number; maxTextLength: number }
export interface TableValue { headers: string[]; rows: string[][] }
export interface ChartValue { categories: string[]; series: Array<{ name: string; values: number[] }> }
export interface Palette { primary: string; onPrimary: string; secondary: string; background: string; surface: string; text: string; mutedText: string; border: string; chart: string[] }
export type NodeValue = TextValue | number | AssetPathValue | TableValue | ChartValue;
export interface DeckInputSlide {
  templateId: string;
  nodes?: Record<string, NodeValue>;
  lists?: Record<string, Array<Record<string, NodeValue>>>;
  sourceRefs?: string[];
}
export interface DeckInput { palette?: Palette; title?: string; slides: DeckInputSlide[] }

export interface LintResult { errors: string[]; warnings: string[] }
