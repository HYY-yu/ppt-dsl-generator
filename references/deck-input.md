# DeckInput 映射

使用 Manifest 自动生成的 key，不根据视觉位置发明字段名。

```json
{
  "title": "演示文稿标题",
  "slides": [
    {
      "templateId": "slide_008",
      "nodes": {
        "text_1": "页面标题"
      },
      "lists": {
        "list_1": [
          {
            "text_1": "第一项标题",
            "text_2": "第一项说明",
            "icon_1": { "path": "/absolute/cache/icon.svg" }
          }
        ]
      },
      "sourceRefs": ["source-1"]
    }
  ]
}
```

## 映射规则

- 在生成大纲前先计算目录容量。对每个目录页，列出其全部列表可能产生的目录项总数；多个目录页取并集，再与 `{3,4,5,6}` 求交。大纲章节数必须属于该可行集合，目录项总数随后与章节过渡页数量保持一致。
- 选择具体模板页时，先按 `pageType`、列表容量和必要资产可用性硬过滤。内容页再按大纲中有序 `logic_relations` 的首个命中项排序，其后依次比较容量接近度、资产适配度、连续重复惩罚和累计使用惩罚；最终使用 `templateId` 做稳定 tie-break。版式多样性不得压过明显更好的语义匹配。
- `nodes` 仅填写页面级组件。
- `lists.list_N` 仅填写对应列表；每项 key 必须来自 `componentContract`。
- 所有 `number_N` 均可从 `DeckInput` 省略，包括固定列表、变长列表和章节过渡页的页面级序号。列表序号按 Item 位置从 1 填充；页面级序号只允许出现在章节过渡页，按过渡页出现顺序从 1 填充。普通 `validate-input` CLI 与 `generate` 都会在完整校验前执行该确定性绑定；调用底层 `validateDeckInput()` 的代码则必须先自行调用同一绑定逻辑。最终以整数保存，由模板 `numberWidth` 渲染为 `1`、`01` 或 `001` 等格式。
- 使用 LLM 时只让模型生成文本和列表结构，不让模型生成序号、图片或图标。使用 `deck-content.schema.json` 或从已选模板派生的同类文本 Schema；文本通过内容校验后再绑定非文本字段。
- 使用 `validate-input --content-only` 检查文本草稿；绑定图片和图标后，再使用普通 `validate-input` 检查最终输入。序号可继续省略，由 CLI 自动绑定。
- 最终图片与图标必须是本地绝对路径或 `{ "path": "..." }`。图片只能使用该页候选，专门生成的图片不得跨页；图标根据页面和列表项文本确定性选择，并轻量惩罚重复使用。
- 文本必须满足 Unicode 码点长度范围；不要机械截断事实。
- 为 provider JSON Schema 增加安全余量时，只有 `maxLength > 10` 的文本范围才允许百分比内缩；`maxLength <= 10` 必须原样保留。例如 `[2,4]` 仍为 `[2,4]`，不得收缩成 `[3,3]`。
- 动态列表从第一项的模板 DSL/Manifest `componentContract` 继承文本范围，不得从第一项实际填充值推导长度。第一项填入 3 字时，不能把后续 `[2,4]` 项限制成 3 字。
- 固定列表项数必须与模板相同；变长列表必须在 Group 声明范围内。
- Deck 必须包含封面页、唯一目录页、3-6 张章节过渡页、内容页和结尾页；封面为第一张，目录为第二张，结尾为最后一张。
- 所有目录列表项的总数必须等于章节过渡页数量；每个目录项对应一张过渡页，每张过渡页后至少有一张内容页，过渡页序号按出现顺序从 1 连续递增。
- 同一页多个同类型组件按 Manifest 中的 `sampleContent`、节点几何和 ordinal 判断用途。
- `sampleContent` 是模板原内容提供的语义示例。生成 DeckInput 时必须让 LLM 在 prompt 或 structured-output JSON Schema 的字段 `description` 中看到它，但禁止照抄、禁止把它当作事实来源，也禁止按样例实际字数收窄 DSL 长度范围。
- 新编译 Manifest 的列表 `componentContract` 直接保存 `sampleContent`；处理旧 Manifest 时，若该字段缺失，从 `items[0].components` 中按相同 key 回填。
- 一旦得到可定位、可校验的候选，只按验证报告执行 `set_text`、`replace_list` 或 `remove`；不得重新生成完整 DeckInput。列表结构错误优先整体 `replace_list`，连续 3 轮验证指纹不变时停止。

## 两种校验模式

### `--content-only`

用于 LLM 文本草稿：

- 允许页面级 `text_n`。
- 允许列表结构和列表项 `text_n`。
- 仍校验 `templateId`、文本/列表 key、文本长度、非法字符、列表项数、整套 Deck 页面结构、目录项数和章节数量。
- 允许缺少 `number_n/image_n/icon_n`。
- 禁止主动返回 `number_n/image_n/icon_n`；这些字段即使值正确也属于草稿合同之外，会报“不允许字段”。
- 成功退出码为 0；任何错误抛出并以非 0 退出。

### 普通最终模式

用于资产绑定后的完整 `DeckInput`：

- 校验所有文本、图片、图标和列表结构。
- 图片和图标必须是可读本地路径或 `{ "path": "..." }`，并满足支持的扩展名。
- `number_n` 仍可省略；CLI 会先按章节或 Item 位置补齐，再验证连续性和显示宽度。
- 不允许缺失必填图片或图标，也不允许多余 key。
- 成功退出码为 0；任何错误抛出并以非 0 退出。

```bash
# LLM 只完成文本后
npm run validate-input -- --manifest "$MANIFEST" --input "$DECK_CONTENT_DRAFT" --content-only

# 图片和图标绑定后；number_n 仍可省略
npm run validate-input -- --manifest "$MANIFEST" --input "$DECK_INPUT"
```
