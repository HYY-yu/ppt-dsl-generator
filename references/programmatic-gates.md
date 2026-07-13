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
- 文本长度满足范围。
- 固定列表项数精确匹配；变长列表项数在范围内。
- Deck 包含封面页、目录页、内容页和结尾页；第一张为封面，最后一张为结尾，目录先于第一张章节过渡页。
- 目录页至少包含 1 个目录项。
- 目录列表项总数与章节过渡页数量完全一致，章节序号连续。
- 图片和 SVG 是可读的本地支持格式。
- 所有必填节点均有值；列表序号除外。

## 输出 Gate

- PPTX ZIP 包可读取且非空。
- 页面数量与输入一致。
- 不存在未被 `ppt/presentation.xml` 引用的孤立 slide XML。
- 不存在 notes parts、notes relationships 或 notes content types。
- 不存在悬空内部关系、孤立关系部件或缺失图片关系。
- 原生 SVG 必须包含 `image/svg+xml` content type、包内 SVG 媒体、`asvg:svgBlip` 关系和透明 PNG 基础关系。
- 最终 slide XML 不含以 `@` 开头的选择窗格名称。
- 所有媒体文件位于 PPTX 包内，不依赖外部 URL。

任何 Gate 失败都必须返回非零退出码和明确错误。只有程序 Gate 暴露兼容性问题或用户明确要求时才进入渲染调试。
