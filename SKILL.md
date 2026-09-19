---
name: ppt-node-dsl-generator
description: 编译和使用在 PowerPoint 选择窗格节点名称中标记 DSL 的 PPTX 模板。用于分析节点名中的文本、图片、图标、序号、原生表格、原生图表、固定列表和 Group 化定长/变长列表，根据页面备注中的页面类型与逻辑关系生成受约束的大纲、DeckInput 和 PPTX，并以程序性结构校验替代逐页人工视觉 QA。
---

# PPT 节点 DSL 生成器

将模板视为经过一次性编译的封闭布局系统。仅修改选择窗格名称中带 DSL 的节点；不要重画页面，不要推测未标记节点的用途。

## 资源

- `assets/ppt-node-dsl-project/`：Node/TypeScript 编译、校验、生成和验证项目。
- `examples/模板节点DSL标记指南.md`：指导用户制作自己的节点 DSL 模板；用户未提供合格模板时读取。
- `examples/ppt_example.pptx`：节点 DSL 标记示例，仅用于学习和测试，不得作为默认模板或写入固定生成流程。
- `references/node-dsl-spec.md`：节点名、Group 定长/变长列表、备注和继承规则。编译模板或排查 lint 时读取。
- `references/deck-input.md`：Manifest 到 `DeckInput` 的映射规则。大纲确认后读取。
- `references/deck-fill-workflow.md`：章节批次、文本草稿、确定性序号/资产绑定和精确修复流程。使用 LLM 填充内容时读取。
- `references/rich-text.md`：长文本框的加粗、下划线、无序列表和有序列表合同。使用 LLM 填充长文本或排查富文本输出时读取。
- `references/image-generation.md`：AI 生图数量、风格、提示词和图片框填充规则。需要补充或生成图片时读取。
- `references/icon-sources.md`：免费 SVG 图标来源、下载与许可记录规则。需要填充图标时读取。
- `references/programmatic-gates.md`：无需人工视觉 QA 时仍不得绕过的程序 gate。生成和交付时读取。
- `references/outline-workflow.md`：从用户需求和可用资料生成并循环确认大纲的职责边界。进入大纲阶段时读取；用户没有提供资料时也必须读取。

- `references/native-data-components.md`：`@表格`、`@图表`、数据 JSON、原生工作簿同步和可选配色合同。处理数据组件时读取。
- `references/template-integration-qa.md`：目录适配、文本边界、模板版本和分层验收。新模板接入或 runtime 能力发布时读取。

## 工作流

### 1. 编译模板

要求用户提供待编译的 PPTX 模板。用户尚未标记模板时，指导其复制自己的设计稿并按 `examples/模板节点DSL标记指南.md` 和 `references/node-dsl-spec.md` 完成标记。不得自动使用 examples 中的 PPTX 代替用户输入。

复制或复用 `assets/ppt-node-dsl-project/`，缺少依赖时运行 `npm ci`，然后执行：

```bash
npm run compile-template -- --template "$TEMPLATE_PPTX" --out "$COMPILED_DIR"
```

编译必须输出：

- `template.pptx`：保留 DSL 名称和备注的编译模板副本。
- `template-manifest.json`
- `input.schema.json`
- `deck-content.schema.json`
- `template-lint.json`
- `template.lock.json`

Lint 失败时停止。报告页码、shapeId、节点名和原因；不要修改用户原始模板，不要把无法解析的 DSL 当普通节点跳过。

### 2. 大纲确认

读取 `references/outline-workflow.md`，从用户需求和可用资料生成每页包含页面类型、有序逻辑关系、标题、要点、视觉需求和来源引用的大纲。用户只提供主题、没有原始资料时，由 Agent 根据事实性、时效性和风险自主决定检索资料或基于通用知识组织内容，不向用户弹出“提供资料 / 套用示例 / 通用汇报 / 只编译”等来源选择题；检索失败或只能依赖假设时在大纲中明确标记。持续与用户迭代；确认前不要选择具体模板页或编写 `DeckInput`。

大纲章节数必须先受目录模板容量约束：从 Manifest 中汇总所有目录页可承载的目录项总数，得到可行章节集合，再与默认集合 `{3,4,5,6}` 求交。默认从交集内选择章节数；不得先生成超出目录容量的大纲再依赖最终校验返工。生成恰好 1 张第二页目录，每个章节过渡页后至少安排 1 张内容页。

### 3. 选择模板并规划资产

先按页面类型、列表容量和资产可用性硬过滤，再按有序逻辑关系、容量接近度、版式重复惩罚和稳定 `templateId` 顺序选择 `templateId`。需要补充 AI 图片时先读取 `references/image-generation.md`；需要图标时读取 `references/icon-sources.md`。此阶段只规划页面级资产候选；所有图片和 SVG 都先落到本地缓存，不要将远程 URL 直接写入最终输入。

### 4. 生成并校验 DeckInput

读取 `references/deck-input.md`；使用 LLM 填充时同时读取 `references/deck-fill-workflow.md`。按章节冻结批次，让 LLM 仅生成 `deck-content.schema.json` 允许的文本、页面级表格/图表数据和列表结构；序号、图片和图标必须在文本内容校验通过后由程序或确定性流程绑定。最终 `DeckInput` 只能使用 Manifest 中存在的节点 key、列表 key 和组件 key：

```bash
npm run validate-input -- --manifest "$MANIFEST" --input "$DECK_CONTENT_DRAFT" --content-only
```

绑定序号、图片和图标后执行最终校验：

```bash
npm run validate-input -- --manifest "$MANIFEST" --input "$DECK_INPUT"
```

修复全部错误后才能生成。`--content-only` 允许文本节点、页面级表格/图表数据和列表文本结构；序号、图片/图标路径和 palette 即使有值也会被拒绝；普通最终模式要求图片和图标已绑定，但会在校验前确定性补齐可省略的页面级与列表级序号。文本长度按可见 Unicode 码点计算，折叠重复空白并拒绝零宽字符、格式控制字符和非标准空白；禁止以不可见字符凑字数，精确算法与示例见 `references/node-dsl-spec.md`。若生成端为文本范围增加安全内缩，`maxLength <= 10` 的短文本必须保留模板原始范围，禁止应用百分比内缩。短标题与目录项必须在长度范围内自然改写为完整词语或短语，禁止机械截尾。动态列表后续项继承第一项的模板合同，不得根据第一项实际生成值的长度收窄合同。所有序号均可从输入省略：列表序号按 Item 位置填充，页面级序号只允许出现在章节过渡页并按章节顺序填充。候选可校验后只做路径级 `set_text`、`set_data`、`replace_list` 或 `remove` 修复，不重新生成完整 DeckInput；连续 3 轮验证指纹不变时停止。

编译器必须把文本节点的 `sampleContent` 写入 Manifest、列表 `componentContract` 和 `input.schema.json` 对应字段的 `description`。若使用 LLM 生成 DeckInput，必须让模型在 prompt 或原生 structured-output JSON Schema 中看到这些语义示例；`sampleContent` 只用于理解该槽位大概承载标题、短语、说明或其他哪类文本，禁止照抄，也不得把样例长度当成字段长度合同。兼容旧 Manifest 时，若列表 `componentContract` 缺少 `sampleContent`，从 `items[0].components` 的同 key 组件回填。

使用 LLM 填充时读取 `references/rich-text.md`。文本合同保持向后兼容：普通文本仍是字符串；只有模板长度合同 `maxLength >= 40` 的长文本字段，`deck-content.schema.json` 和 `input.schema.json` 才额外允许结构化富文本对象。Agent 默认输出纯文本，仅在信息层级确实受益时使用富文本：关键结论或术语可少量加粗，极少量重点可加下划线，并列信息使用无序列表，步骤或优先级使用有序列表。标题、目录项、标签、数字和其他短文本不得使用富文本，也不得把 Markdown 标记或手写项目符号塞入纯字符串模拟格式。

含数据组件时读取 `references/native-data-components.md`。标记为页面级 `@表格` / `@图表`，容量由原生组件读取；模型按来源填写数据，程序校验维度、系列、标签与有限数值。配色从既有设计解析结果确定性绑定，不能由模型选择。

### 5. 生成 PPTX

```bash
npm run generate -- \
  --template "$COMPILED_DIR/template.pptx" \
  --manifest "$COMPILED_DIR/template-manifest.json" \
  --input "$DECK_INPUT" \
  --out "$OUTPUT_PPTX"
```

生成器必须：

- 校验模板 SHA-256。
- 拒绝缺少 `slideNumber`、`slidePath`、列表 `items` 或组件 locator 的精简 Manifest。
- 使用原模板页面和母版。
- 按 shapeId 精确替换普通节点与固定列表节点。
- 原生表格保持样式和区域，按合同缩减数据行；图表对每个输出页面独立复制 chart/XLSX，同步缓存、公式和工作簿，避免重复模板页互相覆盖。
- 仅在显式提供 palette 且模板符合主题合同的情况下同步配色；精确命名的 `runtime-page-number` 填充实际页码。
- 以 Group 为列表 Item 边界；无范围声明时保持定长，有范围声明时允许删除、复制并在原列表区域均匀布局。
- 保持 Group 内部组件结构和相对坐标。
- 新设计的变长 Group 列表预制到声明上限，先用最密集情况完成布局检查；批量生成优先删减，不依赖新增 Group 扩展未经验证的空间。
- 保持模板文本框的固定几何与 `a:normAutofit` 溢出缩排设置；禁止把 Node DSL 文本槽位改成会扩大形状的 `a:spAutoFit`。
- 对合格长文本的结构化富文本，按 DrawingML 原生结构生成多个 `a:p/a:r`：加粗和下划线写入 `a:rPr`，无序/有序列表写入 `a:pPr` 的 `a:buChar/a:buAutoNum`；继承模板字体、字号、颜色、段落间距和固定文本框几何，不把 Markdown 符号写进 `a:t`。
- 将模板中每个 Group 的外层几何视为布局合同：Item 数不变时完整保留原始框；Item 数变化且存在交错模式时，只沿主轴重新分布，并继承模板的副轴位置、尺寸和周期。
- 同一固定或变长列表的每个 `icon_n` 以第一项同名图标槽位为标准，取第一项宽高较短边作为统一边长，将后续图标框改为相同正方形并保持各自中心点不变。
- 光栅图片按真实宽高居中裁剪填充目标图片框：保持模板图片框的位置、尺寸和形状，不拉伸、不留白；宽图对称裁左右，长图对称裁上下。
- 将图片写入 PPTX 本地媒体包；SVG 以 Office 2019+ 原生 `asvg:svgBlip` 单 SVG 关系写入，不添加透明 PNG fallback、不栅格化、不依赖操作系统转换器。将 SVG 的 `currentColor` 物化为显式颜色：图标中心下方可确认是白色或近白色填充时使用深灰 `#404040`，其他背景或无法确认时使用白色 `#FFFFFF`。
- 保持 `pptx-automizer@0.8.2` 的内置 `cleanup` 关闭，避开其在未解析 SVG fallback 关系上解引用 `undefined` 的崩溃；由生成器后处理确定性删除未引用 slide parts、relationships 和媒体。
- 替换 icon 时只保留模板槽位的变换信息（位置、尺寸、旋转和翻转），将节点重建为无填充、无线条的矩形图片；不得继承模板原 icon 的 `custGeom`、填充、线条、阴影或其他效果，否则新 SVG 可能仍呈现原模板图标的外观。
- 每个被替换的图片或 icon 节点创建独立 image relationship，不复用或重定向模板已有的共享 `rId`；整页替换完成后统一清理未引用图片关系。
- 删除备注、悬空关系、孤立关系，以及 `ppt/_rels/presentation.xml.rels` 中 Office 不允许的 `Presentation -> SlideLayout` 显式关系。
- 将 Automizer 产生的 `rId*-created` 等非规范 relationship ID 改写为纯数字 `rIdN`，并同步更新 owner XML 中的引用。
- 若动态列表或节点替换删除了动画所引用的形状，只裁剪全部目标都已消失的动画分支并保留同页其余有效动画；只有无法安全局部修复或已无有效目标时才移除整页 `<p:timing>`。
- 模板页或 Group 被复用时，为重复的 slide `p14:creationId` 和 shape `a16:creationId` 重新分配唯一值。
- 将交付 PPTX 中以 `@` 开头的 DSL 名称清理为普通节点名。
- 保留编译模板中的 DSL 名称。

### 6. 程序性验证与交付

读取 `references/programmatic-gates.md` 并执行：

```bash
npm run verify -- --pptx "$OUTPUT_PPTX"
```

只有验证退出码为 0 才能交付。默认不渲染 PNG、不生成 montage、不执行逐页人工视觉 QA。新模板或新数据组件发布、模板开发者要求调试、程序 gate 暴露兼容问题时，按 `references/template-integration-qa.md` 增加视觉和原生 PowerPoint/Excel 验收。

## 硬性边界

- Group 列表的第一项必须从 `@1@1` 开始，后续为 `@1@2`、`@1@3`。第一项不声明范围时，列表长度固定为模板中的 Group 数量；声明 `@1@1[3-5]` 时为允许 3-5 项的变长列表。
- `@表格`、`@图表` 只支持页面级原生 graphicFrame；禁止列表嵌套、假表格图片、无工作簿图表和未经支持的图表类型。
- Group 内组件只标记 `@文本`、`@图片`、`@图标`、`@序号`，不得重复列表前缀。
- 固定列表可继续使用节点名 `@1@1 文本[4-10]`、`@1@2 文本`。
- 同一列表不能混用 Group DSL 和固定列表节点 DSL。
- 生成 Deck 必须包含封面页、目录页、章节过渡页、内容页和结尾页；第一张必须是封面页，第二张必须是唯一目录页，最后一张必须是结尾页。
- 默认章节数量为 3-6，并且必须属于 Manifest 中目录页容量形成的可行章节集合；每张章节过渡页后必须至少有 1 张内容页，内容页不得出现在第一张章节过渡页之前。
- 目录列表项数必须与章节过渡页数量完全一致；章节过渡页序号必须从 1 开始连续递增。
- LLM 只生成文本、页面级表格/图表数据和列表结构；页面级与列表级序号、图片和图标均由确定性流程后置绑定。
- 第一项定义列表组件合同，后续项继承长度、序号格式和组件槽位，并且组件结构必须完全一致。
- 第一项的实际填充值不参与合同推导；`@文本[2-4]` 必须始终允许后续项填写 2-4 字。最大长度不超过 10 的文本范围不得做百分比内缩。
- `sampleContent` 必须进入普通节点、列表 `componentContract` 和面向 LLM 的 JSON Schema/prompt；它是语义示例，不是默认输出、事实来源或长度合同。
- 富文本只允许用于 `maxLength >= 40` 的文本字段；短文本始终为字符串。富文本 v1 只支持单层段落、`bold`、`underline`、`bullet` 和 `number`，不支持嵌套列表、Markdown、HTML、颜色或字体覆盖。
- 富文本长度等于各 run 的 `text` 按段落顺序连接后的可见文本长度；段落边界按一个普通空白处理，自动项目符号和编号不计入 DSL 长度。每个富文本最多 8 个段落，每段最多 12 个 run。
- 变长列表 Group 的外层位置和尺寸属于模板语义；时间轴、阶梯、蛇形等交错布局不得被强制压成单行或单列。
- 新设计的变长列表默认在模板中预制到范围上限；`ppt-master` 种子模板必须如此，以便最大密度先经过布局检查。
- 同一列表的 `icon_n` 必须继承第一项同名图标槽位的较短边，最终图标框为相同正方形且中心点不变。
- 同一 Deck 的 AI 生图限制为 1-3 张且只使用一种已支持风格；按最终选中模板的实际图片框比例量化为 1:1、4:3、16:9、3:4 或 9:16，缺少几何时回退 1:1；主体和关键元素位于中央 70% 安全区，纯装饰、无文字，并由 Runtime 居中裁剪填充模板图片框。
- 未标记节点不得因内容生成而移动、删除或重画；显式 palette 主题映射和 runtime-page-number 页码遵循已声明的模板合同。
- 模板路径始终来自当前用户输入；不得在代码、命令、默认配置或提示词中硬编码 examples 文件名或任何历史模板路径。
- 原生 SVG 输出只面向 PowerPoint 2019 及以上版本；不为旧版 Office 执行栅格化兼容处理。
- icon 输出节点必须使用干净的矩形 `p:spPr`，不得保留模板 icon 的 `a:custGeom`、`a:solidFill`、可见线条或效果；模板 icon 仅提供槽位变换合同。
- `ppt/presentation.xml` 不得直接关联 SlideLayout；页面布局必须经由 SlideMaster/Slide 的合法关系引用。
- 所有 relationship ID 必须匹配 `^rId\d+$`；PowerPoint 会将 `rId*-created` 视为需修复的包。
- 图片或 icon 节点替换不得重定向共享 relationship；最终 slide relationships 中不得残留未被同页 XML 引用的 image relationship。
- `ppt/media` 不得保留未被任何有效内部 relationship 引用的孤立媒体；生成器后处理必须删除，程序性验证必须拒绝。
- 所有动画目标 `spid` 必须能在同页 `p:cNvPr/@id` 中找到；悬空引用必须在生成阶段清理。
- 要求每个动态列表 Item 都有动画时，模板必须预制到声明的最大 Group 数并逐组配置动画；生成器新复制出的超出预制数量的 Group 不会自动继承 PowerPoint 动画。
- slide `p14:creationId` 和 shape `a16:creationId` 在整份输出 Deck 中不得重复。
- 不隐藏异常：解析失败、资源下载失败、关系损坏和输入越界都必须报错。
- 不增加大型第三方依赖；优先使用项目现有的 JSZip、fast-xml-parser 和 pptx-automizer。
