export type PageType = "封面页" | "目录页" | "章节过渡页" | "内容页" | "结尾页";
export type ComponentKind = "text" | "image" | "icon" | "number";

export interface LengthRange { min: number; max: number; fixed: boolean }
export interface Box { x: number; y: number; cx: number; cy: number }

export interface NodeLocator {
  shapeId: string;
  shapeName: string;
  nodeType: "sp" | "pic" | "grpSp";
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

export type NodeValue = string | number | { path: string };
export interface DeckInputSlide {
  templateId: string;
  nodes?: Record<string, NodeValue>;
  lists?: Record<string, Array<Record<string, NodeValue>>>;
  sourceRefs?: string[];
}
export interface DeckInput { title?: string; slides: DeckInputSlide[] }

export interface LintResult { errors: string[]; warnings: string[] }
