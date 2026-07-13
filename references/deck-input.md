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

- 先匹配 `pageType`，再匹配 `logic`、列表容量、节点种类和文本范围。
- `nodes` 仅填写页面级组件。
- `lists.list_N` 仅填写对应列表；每项 key 必须来自 `componentContract`。
- 列表项中的 `number_N` 可省略，生成器按 Item 位置和模板 `numberWidth` 自动产生；页面级序号节点不可省略。
- 图片与图标必须是本地绝对路径或 `{ "path": "..." }`。
- 文本必须满足 Unicode 码点长度范围；不要机械截断事实。
- 固定列表项数必须与模板相同；变长列表必须在 Group 声明范围内。
- Deck 必须包含封面页、目录页、内容页和结尾页；封面为第一张，结尾为最后一张，目录位于第一张章节过渡页之前。
- 所有目录列表项的总数必须等于章节过渡页数量；每个目录项对应一张过渡页，过渡页序号按出现顺序从 1 连续递增。
- 同一页多个同类型组件按 Manifest 中的 `sampleContent`、节点几何和 ordinal 判断用途。
