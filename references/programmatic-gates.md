# 程序性 Gate

“无需 QA”指无需逐页人工视觉 QA，不代表跳过结构验证。

## 模板编译 Gate

- 页面类型有效且覆盖五种必要类型。
- 所有以 `@` 开头的节点名均成功解析。
- 节点数据类型和 OOXML 节点存在。
- 文本长度、图片编号、序号样例有效。
- 固定列表合同一致。
- Group 列表的编号和组件合同一致；无范围时固定为模板 Group 数量，有范围时模板项数位于范围内。
- Manifest 记录模板 SHA-256。
- Runtime Manifest 完整保留每页 `slideNumber/slidePath`、列表 `items`，以及所有可编辑组件的 `locator.shapeId/path`；禁止把只用于匹配的精简 Manifest 送入生成器。
- 普通文本节点和列表第一项的 `sampleContent` 已写入 Manifest；列表 `componentContract` 保留同 key 的 `sampleContent`，生成的 `input.schema.json` 通过字段 `description` 暴露语义示例。
- 编译同时生成只暴露文本和列表容量的 `deck-content.schema.json`；非文本字段不得进入 LLM 内容草稿合同。

## 输入 Gate

- `templateId`、节点 key、列表 key 和组件 key 均存在于 Manifest。
- 文本长度按可见 Unicode 码点满足范围：前导/尾随空白不计数，内部连续空白只在两个可见字符之间计 1；零宽字符、格式控制字符与非标准空白一律拒绝。
- `maxLength <= 10` 的短文本保留模板原始范围，不应用百分比内缩；动态列表后续项继承第一项模板合同，不继承第一项实际填充值的长度。
- 短标题和目录项是自然、完整的词语或短语；容量不足时改写，不机械截掉末尾字符。
- 固定列表和无范围 Group 列表项数精确匹配；有范围 Group 列表项数在声明范围内。
- Deck 包含封面页、唯一目录页、章节过渡页、内容页和结尾页；第一张为封面，第二张为目录，最后一张为结尾。
- 大纲生成前已从所有目录模板的列表容量计算可行章节集合，并与 `{3,4,5,6}` 求交；实际章节数必须属于该集合。每张章节过渡页后至少有一张内容页，内容页不得出现在第一张章节过渡页之前，目录与结尾之间不得混入其他页面类型。
- 目录页至少包含 1 个目录项。
- 目录列表项总数与章节过渡页数量完全一致，章节序号连续。
- LLM 草稿只包含文本和列表结构；`--content-only` 必须拒绝草稿主动携带序号、图片或图标。内容校验通过后，页面级图片和语义图标按确定性规则绑定；所有序号允许继续省略，由普通 `validate-input` 或 `generate` 在完整校验前补齐。
- 可校验候选的修复只允许验证报告要求的 `set_text`、`replace_list`、`remove`；拒绝未请求路径、重复路径、操作不匹配和完整 DeckInput 重生成。连续 3 轮问题指纹不变时失败退出。
- 图片和 SVG 是可读的本地支持格式。
- AI 生图数量为 1-3 张，同一 Deck 风格一致；按最终选中 holder 几何量化为 1:1、4:3、16:9、3:4 或 9:16，缺少几何时回退 1:1；主体位于中央 70% 安全区，提示词包含纯装饰和完全无文字约束。
- 所有必填文本、图片和图标节点均有值；固定列表、变长列表和章节过渡页的序号字段都可省略，由确定性流程绑定。

## 输出 Gate

- PPTX ZIP 包可读取且非空。
- 页面数量与输入一致。
- 不存在未被 `ppt/presentation.xml` 引用的孤立 slide XML。
- 不存在 notes parts、notes relationships 或 notes content types。
- 不存在悬空内部关系、孤立关系部件或缺失图片关系。
- 每个被替换的图片/icon 节点使用独立 image relationship；不存在未被同页 XML 引用的 image relationship。
- `ppt/media` 中每个媒体文件至少被一个有效内部 relationship 引用；关闭 Automizer 内置 cleanup 后留下的孤立媒体由生成器后处理删除，并由 `verify` 拒绝回归。
- `ppt/_rels/presentation.xml.rels` 不存在指向 SlideLayout 的显式关系；SlideLayout 只能通过 SlideMaster/Slide 的合法关系链使用。
- 所有 `.rels` 中的 relationship ID 必须匹配 `^rId\d+$`；生成阶段必须规范化 `rId*-created` 并同步 owner XML 引用。
- 所有 `<p:timing>` 中的动画目标 `spid` 必须引用同页现存形状；动态列表删减造成悬空引用时，生成阶段只裁剪已删除 Item 对应的动画分支并保留同页有效动画，只有无法安全修复或已无有效目标时才删除整页 timing block。
- 所有 slide `p14:creationId` 与 shape `a16:creationId` 在整份 Deck 中唯一；模板页或 Group 克隆后必须重新分配重复 ID。
- 原生 SVG 必须包含 `image/svg+xml` content type、包内 SVG 媒体和唯一 `asvg:svgBlip` 关系；`a:blip` 不得再声明透明 PNG fallback 关系。
- 同页普通光栅图片和原生 SVG 必须按各自独立的 `<a:blip>` 校验；不得跨自闭合 `<a:blip .../>` 或相邻图片边界推断 SVG fallback。
- 原生 SVG icon 所在 `p:pic/p:spPr` 必须是干净的矩形图片几何；不得保留模板节点的 `a:custGeom`，生成阶段必须移除模板 icon 的填充、线条与效果，仅保留位置、尺寸、旋转和翻转信息。
- 原生 SVG 不得将 `currentColor` 留到 PowerPoint 运行时解析；生成阶段必须按模板背景物化为显式颜色。白色/近白色背景使用 `#404040`，其他或无法确认的背景使用 `#FFFFFF`。
- 同一列表的每个 `icon_n` 输出框必须使用第一项同名槽位的较短边形成统一正方形，且调整前后中心点保持不变。
- 光栅图片替换后保留模板图片框几何和形状；按源图与目标框比例生成对称 `a:srcRect` 并使用 `a:stretch/a:fillRect` 居中裁剪填充，不残留 `a:tile` 或旧裁剪参数。
- 光栅关系替换必须在目标节点自己的 `p:blipFill` 或 `a:blipFill` 内更新 `r:embed`，不得因节点外层是 `p:pic`/`p:sp` 而保留模板关系，也不得改写同页其他图片的关系。
- 最终 slide XML 不含以 `@` 开头的选择窗格名称。
- 所有媒体文件位于 PPTX 包内，不依赖外部 URL。

任何 Gate 失败都必须返回非零退出码和明确错误。只有程序 Gate 暴露兼容性问题或用户明确要求时才进入渲染调试。
