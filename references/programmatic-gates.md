# 程序性 Gate

“无需 QA”指无需逐页人工视觉 QA，不代表跳过结构验证。

## 模板编译 Gate

- 页面类型有效且覆盖五种必要类型。
- 所有以 `@` 开头的节点名均成功解析。
- 节点数据类型和 OOXML 节点存在。
- 文本长度、图片编号、序号样例有效。
- 固定列表合同一致。
- 变长列表全部为 Group，范围、编号和组件合同一致。
- Manifest 记录模板 SHA-256。

## 输入 Gate

- `templateId`、节点 key、列表 key 和组件 key 均存在于 Manifest。
- 文本长度按可见 Unicode 码点满足范围；重复空白折叠计数，零宽字符、格式控制字符与非标准空白一律拒绝。
- `maxLength <= 10` 的短文本保留模板原始范围，不应用百分比内缩；动态列表后续项继承第一项模板合同，不继承第一项实际填充值的长度。
- 短标题和目录项是自然、完整的词语或短语；容量不足时改写，不机械截掉末尾字符。
- 固定列表项数精确匹配；变长列表项数在范围内。
- Deck 包含封面页、目录页、内容页和结尾页；第一张为封面，最后一张为结尾，目录先于第一张章节过渡页。
- 目录页至少包含 1 个目录项。
- 目录列表项总数与章节过渡页数量完全一致，章节序号连续。
- 图片和 SVG 是可读的本地支持格式。
- AI 生图数量为 1-3 张，同一 Deck 风格一致，尺寸均为 1:1；主体位于中央安全区，提示词包含纯装饰和完全无文字约束。
- 所有必填节点均有值；列表序号除外。

## 输出 Gate

- PPTX ZIP 包可读取且非空。
- 页面数量与输入一致。
- 不存在未被 `ppt/presentation.xml` 引用的孤立 slide XML。
- 不存在 notes parts、notes relationships 或 notes content types。
- 不存在悬空内部关系、孤立关系部件或缺失图片关系。
- 每个被替换的图片/icon 节点使用独立 image relationship；不存在未被同页 XML 引用的 image relationship。
- `ppt/_rels/presentation.xml.rels` 不存在指向 SlideLayout 的显式关系；SlideLayout 只能通过 SlideMaster/Slide 的合法关系链使用。
- 所有 `.rels` 中的 relationship ID 必须匹配 `^rId\d+$`；生成阶段必须规范化 `rId*-created` 并同步 owner XML 引用。
- 所有 `<p:timing>` 中的动画目标 `spid` 必须引用同页现存形状；动态列表删减造成悬空引用时，生成阶段只裁剪已删除 Item 对应的动画分支并保留同页有效动画，只有无法安全修复或已无有效目标时才删除整页 timing block。
- 所有 slide `p14:creationId` 与 shape `a16:creationId` 在整份 Deck 中唯一；模板页或 Group 克隆后必须重新分配重复 ID。
- 原生 SVG 必须包含 `image/svg+xml` content type、包内 SVG 媒体和唯一 `asvg:svgBlip` 关系；`a:blip` 不得再声明透明 PNG fallback 关系。
- 原生 SVG 不得将 `currentColor` 留到 PowerPoint 运行时解析；生成阶段必须按模板背景物化为显式颜色。白色/近白色背景使用 `#404040`，其他或无法确认的背景使用 `#FFFFFF`。
- 同一列表的每个 `icon_n` 输出框必须使用第一项同名槽位的较短边形成统一正方形，且调整前后中心点保持不变。
- 光栅图片替换后保留模板图片框几何和形状；按源图与目标框比例生成对称 `a:srcRect` 并使用 `a:stretch/a:fillRect` 居中裁剪填充，不残留 `a:tile` 或旧裁剪参数。
- 最终 slide XML 不含以 `@` 开头的选择窗格名称。
- 所有媒体文件位于 PPTX 包内，不依赖外部 URL。

任何 Gate 失败都必须返回非零退出码和明确错误。只有程序 Gate 暴露兼容性问题或用户明确要求时才进入渲染调试。
