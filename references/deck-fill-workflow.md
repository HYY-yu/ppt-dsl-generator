# Deck 内容填充与修复

把内容生成、确定性字段绑定和最终校验分开。LLM 只负责从事实来源提炼文本与表格/图表数据；不得让模型生成序号、图片路径或图标路径。

## 1. 冻结章节批次

大纲确认并选定模板页后，按以下边界固定批次：

1. `front_matter`：封面页与目录页。
2. `chapter_N`：一张章节过渡页及其后、下一张章节过渡页之前的全部内容页。
3. `closing`：结尾页。

同一次任务的重试复用相同批次边界，不按固定页数重新切分。每个批次显式保存全局 slide index、稳定 slide ID 和唯一 `templateId`；响应必须逐项原样返回这些绑定。

## 2. 构造精简文本合同

从已选模板 Manifest 派生当前批次的内容合同，只暴露：

- slide ID 与 `templateId` 绑定。
- 页面级 `text_n`、`table_n`、`chart_n`。
- 列表 key、`minItems/maxItems` 和列表项 `text_n`。
- 文本 `min/max` 与 `sampleContent`。
- `maxLength >= 40` 的长文本字段同时暴露 `references/rich-text.md` 定义的富文本对象分支；短文本只暴露字符串。

不要向 LLM 发送 locator、shapeId、图片候选、图标目录、序号字段、模板评分或未选中的模板页。`deck-content.schema.json` 是文本与数据草稿 Schema；若只处理当前批次，从完整 Manifest 中截取已选模板页后重新构造同类 Schema。

输入同时包含原始资料和已确认大纲。原始资料是事实来源；大纲是叙事顺序与页面意图。允许模型按模板容量重新选择、压缩、拆分或组合事实，但禁止编造。

## 3. 生成文本草稿

要求模型：

- 只返回合同允许的文本 key、页面级表格/图表数据和列表结构。
- 不返回 `number_n`、`image_n`、`icon_n`。
- 按可见 Unicode 码点满足安全范围。
- 把 `sampleContent` 只当语义示例，不照抄、不当事实、不当长度规则。
- 让短标题和目录项成为完整自然的词语或短语，不机械截尾。
- 默认输出字符串。长文本确有层级时才使用结构化富文本：少量关键短语加粗、极少量重点加下划线，并列要点用 `bullet`，连续步骤用 `number`；不输出 Markdown 或手写项目符号。
- 富文本每个 paragraph 必须显式返回 `list` 与 `runs`，每个 run 显式返回 `text/bold/underline`。同一 run 不含换行，换段通过 paragraph 表达。

先执行内容校验；此阶段允许缺少序号、图片和图标，但不允许错误文本 key、错误列表 key、列表越界或非法字符：

```bash
npm run validate-input -- --manifest "$MANIFEST" --input "$DECK_CONTENT_DRAFT" --content-only
```

`--content-only` 不只是放宽“缺少非文本字段”：它同时禁止草稿主动携带 `number_n`、`image_n`、`icon_n` 或顶层 `palette`。这些字段必须留给后置确定性流程。该模式仍执行整套 Deck 的页面结构、目录项数、章节数量、列表容量和文本长度校验。

## 4. 确定性绑定

文本草稿通过后依次绑定：

1. 列表 `number_n`：可以写入，也可以继续省略；最终 CLI/Runtime 会按 Item 位置写入从 1 开始的整数。
2. 章节过渡页 `number_n`：可以写入，也可以继续省略；最终 CLI/Runtime 会按过渡页出现顺序写入从 1 开始的整数。
3. 图片：只从该页已分配的本地候选中按图片槽位顺序绑定；专门生成的图片只能用于目标页。
4. 图标：根据页面标题、核心信息、已填文本和列表项文本选择；相同语义优先稳定命中，并对重复使用施加轻量惩罚。

Runtime 根据模板 `numberWidth` 显示序号：`@序号-1`、`@序号-01`、`@序号-001` 分别产生 `1`、`01`、`001`。最终 `DeckInput` 中的图片和图标必须是可读本地路径或 `{ "path": "..." }`。

绑定图片和图标后使用完整 Manifest 重新执行最终输入校验。普通 `validate-input` 和 `generate` 会先确定性补齐所有省略的序号，再执行完整校验；最终模式不会放行缺失图片或图标。

## 5. 精确修复

一旦得到可定位、可校验的候选，禁止重新生成整个 DeckInput。仅根据验证报告产生以下操作：

- `set_text`：补齐或改写一个文本字段。
- `set_data`：替换被报告的页面级表格/图表数据对象；这是调用方补丁约定，不是 CLI 命令。
- `replace_list`：整体重建缺失、越界或结构损坏的列表。
- `remove`：删除多余字段或列表。

每个验证路径必须且只能返回一个操作；拒绝未请求路径、重复路径、操作类型不匹配和完整 DeckInput 响应。若列表本身存在结构错误，将其子字段错误合并进同一次 `replace_list`，避免补丁互相覆盖。

每轮修复后重新验证，并以 `path + issue code + actual + min/max + expected` 生成稳定指纹。默认最多尝试 20 轮；连续 3 轮指纹不变时立即停止并报告停滞，不以无限重试隐藏问题。

## 原生数据补充

`@表格` / `@图表` 的精确语法、容量与 JSON 见 [原生数据组件](native-data-components.md)。`--content-only` 同样校验数据合同；最终 palette 由确定性流程绑定。调用方定向修复数据时使用 `set_data` 替换被报告的整个数据对象并重验，不能当文本处理。新模板/新组件验收见 [模板接入验收](template-integration-qa.md)。
