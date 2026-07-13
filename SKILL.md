---
name: ppt-node-dsl-generator
description: 编译和使用在 PowerPoint 选择窗格节点名称中标记 DSL 的 PPTX 模板。用于分析节点名中的文本、图片、图标、序号、固定列表和 Group 化变长列表，根据页面备注中的页面类型与逻辑关系生成受约束的大纲、DeckInput 和 PPTX，并以程序性结构校验替代逐页人工视觉 QA。
---

# PPT 节点 DSL 生成器

将模板视为经过一次性编译的封闭布局系统。仅修改选择窗格名称中带 DSL 的节点；不要重画页面，不要推测未标记节点的用途。

## 资源

- `assets/ppt-node-dsl-project/`：Node/TypeScript 编译、校验、生成和验证项目。
- `examples/模板节点DSL标记指南.md`：指导用户制作自己的节点 DSL 模板；用户未提供合格模板时读取。
- `examples/ppt_example.pptx`：节点 DSL 标记示例，仅用于学习和测试，不得作为默认模板或写入固定生成流程。
- `references/node-dsl-spec.md`：节点名、Group 变长列表、备注和继承规则。编译模板或排查 lint 时读取。
- `references/deck-input.md`：Manifest 到 `DeckInput` 的映射规则。大纲确认后读取。
- `references/icon-sources.md`：免费 SVG 图标来源、下载与许可记录规则。需要填充图标时读取。
- `references/programmatic-gates.md`：无需人工视觉 QA 时仍不得绕过的程序 gate。生成和交付时读取。
- `references/outline-workflow.md`：从用户资料生成并循环确认大纲的职责边界。收到内容资料后读取。

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
- `template-lint.json`
- `template.lock.json`

Lint 失败时停止。报告页码、shapeId、节点名和原因；不要修改用户原始模板，不要把无法解析的 DSL 当普通节点跳过。

### 2. 大纲确认

读取 `references/outline-workflow.md`，从用户资料生成每页包含页面类型、逻辑关系、标题、要点、视觉需求和来源引用的大纲。持续与用户迭代；确认前不要选择模板页或编写 `DeckInput`。

### 3. 选择模板并准备资产

根据页面类型、逻辑关系、文本长度、列表项数和组件种类选择 `templateId`。需要图片时准备本地文件；需要图标时读取 `references/icon-sources.md`，下载 SVG 到本地缓存后再引用。不要将远程 URL 直接写入最终输入。

### 4. 生成并校验 DeckInput

读取 `references/deck-input.md`。只能使用 Manifest 中存在的节点 key、列表 key 和组件 key：

```bash
npm run validate-input -- --manifest "$MANIFEST" --input "$DECK_INPUT"
```

修复全部错误后才能生成。文本长度按 Unicode 码点计算；仅列表项中的序号可省略并由生成器按模板格式和 Item 位置自动产生，页面级序号必须显式填写。

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
- 使用原模板页面和母版。
- 按 shapeId 精确替换普通节点与固定列表节点。
- 以 Group 为变长列表 Item 边界，删除、复制并在原列表区域均匀布局。
- 保持 Group 内部组件结构和相对坐标。
- 将图片写入 PPTX 本地媒体包；SVG 在 macOS 上通过系统 `sips` 转为透明 PNG，缓存中保留 SVG 源文件。
- 删除备注、悬空关系和孤立关系。
- 将交付 PPTX 中以 `@` 开头的 DSL 名称清理为普通节点名。
- 保留编译模板中的 DSL 名称。

### 6. 程序性验证与交付

读取 `references/programmatic-gates.md` 并执行：

```bash
npm run verify -- --pptx "$OUTPUT_PPTX"
```

只有验证退出码为 0 才能交付。默认不渲染 PNG、不生成 montage、不执行逐页人工视觉 QA。模板开发者要求调试或程序 gate 暴露 PowerPoint 兼容问题时，才额外渲染抽查。

## 硬性边界

- 变长列表必须使用 PowerPoint Group；第一项组名声明范围，例如 `@1@1[3-5]`，后续组名为 `@1@2`、`@1@3`。
- Group 内组件只标记 `@文本`、`@图片`、`@图标`、`@序号`，不得重复列表前缀。
- 固定列表可继续使用节点名 `@1@1 文本[4-10]`、`@1@2 文本`。
- 同一列表不能混用 Group DSL 和固定列表节点 DSL。
- 生成 Deck 必须包含封面页、目录页、内容页和结尾页；第一张必须是封面页，最后一张必须是结尾页。
- 目录页必须位于第一张章节过渡页之前，且至少包含 1 个目录项。
- 所有目录页的列表项总数必须与章节过渡页数量完全一致；章节过渡页序号必须从 1 开始连续递增。
- 第一项定义列表组件合同，后续项继承长度、序号格式和组件槽位，并且组件结构必须完全一致。
- 未标记节点不得因内容生成而移动、删除或重画。
- 模板路径始终来自当前用户输入；不得在代码、命令、默认配置或提示词中硬编码 examples 文件名或任何历史模板路径。
- 不隐藏异常：解析失败、资源下载失败、关系损坏和输入越界都必须报错。
- 不增加大型第三方依赖；优先使用项目现有的 JSZip、fast-xml-parser 和 pptx-automizer。
