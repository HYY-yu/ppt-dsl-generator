export type PageType = "封面页" | "目录页" | "内容页" | "结尾页" | "章节过渡页" | string;

export interface LengthRange {
  min: number;
  max: number;
  fixed: boolean;
}

export interface DslComponent {
  scope: "slide" | "listItem";
  raw: string;
  kind: "text" | "image" | "number" | "list" | "listItem" | "icon" | "unknown";
  label?: string;
  length?: LengthRange;
  index?: number;
  imageRole?: ImageRole;
}

export type ImageRole = "content" | "decorative" | "brand";

export interface DslListComponent extends DslComponent {
  kind: "list";
  itemComponents: DslComponent[];
}

export interface ParsedDsl {
  pageType: PageType;
  components: DslComponent[];
  lists: DslListComponent[];
  logic: string[];
  rawNotes: string;
  warnings: string[];
}

export interface TextTarget {
  slidePath: string;
  shapeIndex: number;
  shapeId?: string;
  shapeName?: string;
  shapeNameIndex?: number;
  placeholder: string;
  occurrence: number;
  text: string;
  x?: number;
  y?: number;
  cx?: number;
  cy?: number;
}

export interface ImageTarget {
  key: string;
  role: ImageRole;
  slidePath: string;
  picIndex: number;
  shapeName?: string;
  shapeNameIndex?: number;
  relId?: string;
  target?: string;
  x?: number;
  y?: number;
  cx?: number;
  cy?: number;
}

export interface Box {
  x: number;
  y: number;
  cx: number;
  cy: number;
}

export interface FieldManifest {
  key: string;
  component: DslComponent;
  targets: TextTarget[];
}

export interface ListManifest {
  key: string;
  component: DslListComponent;
  maxItemsInTemplate: number;
  itemFields: FieldManifest[];
}

export interface SlideManifest {
  templateId: string;
  slideNumber: number;
  slidePath: string;
  relId?: string;
  pageType: PageType;
  logic: string[];
  fields: FieldManifest[];
  lists: ListManifest[];
  images: ImageTarget[];
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

export interface DeckInputSlide {
  templateId: string;
  fields?: Record<string, string | number>;
  lists?: Record<string, Array<Record<string, string | number>>>;
  images?: Record<string, string>;
  approvedTemplateImages?: string[];
  sourceRefs?: string[];
  continuation?: {
    sourceIndex: number;
    part: number;
    total: number;
  };
}

export interface DeckInput {
  title?: string;
  slides: DeckInputSlide[];
}
